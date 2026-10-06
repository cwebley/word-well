"""Read and verify the fixed approved evidence. No network, model or database writes."""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import xml.etree.ElementTree as ET

from prepare import DEFAULT_ROOT, PreparationError, outside_checkout


def require(condition, code):
    if not condition:
        raise PreparationError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text())


def verified(path, expected):
    with path.open('rb') as stream:
        actual = hashlib.file_digest(stream, 'sha256').hexdigest()
    require(actual == expected, 'scoped_artifact_changed')
    return {'sha256': actual, 'bytes': path.stat().st_size, 'path': str(path)}


def read_index(path):
    # Immutable reads are valid only for the completed, quiescent acquisition index.
    require(not Path(str(path) + '-wal').exists() or Path(str(path) + '-wal').stat().st_size == 0,
            'scoped_index_has_active_wal')
    connection = sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def xml_records(data, kind):
    pattern = rb'<' + kind.encode() + rb'\b[^>]*>.*?</' + kind.encode() + rb'>'
    for order, match in enumerate(re.finditer(pattern, data, re.S), 1):
        raw = match.group()
        # Namespace declaration belongs to the original document, not the fragment.
        element = ET.fromstring(b'<root xmlns:dc="https://globalwordnet.github.io/schemas/dc/">' + raw + b'</root>')[0]
        yield order, match.start(), raw, element


def relations(element, tag):
    return [dict(item.attrib) for item in element.findall(tag)]


def oewn_bundle(path, scope):
    data = gzip.decompress(path.read_bytes())
    entries = {}
    for order, offset, raw, element in xml_records(data, 'LexicalEntry'):
        lemma = element.find('Lemma')
        entries[element.get('id')] = {'order': order, 'offset': offset, 'raw': raw.decode(),
            'headword': lemma.get('writtenForm'), 'pos': lemma.get('partOfSpeech'),
            'forms': [dict(f.attrib) for f in element.findall('Form')],
            'meanings': [{'id': s.get('id'), 'conceptId': s.get('synset'), 'order': i,
                          'relations': relations(s, 'SenseRelation')} for i, s in enumerate(element.findall('Sense'), 1)]}
    primary = entries.get(scope['oewnEntry'])
    require(primary and [m['id'] for m in primary['meanings']] == scope['oewnMeanings'], 'scoped_oewn_inventory_changed')
    primary_concepts = {m['conceptId'] for m in primary['meanings']}
    family_ids = {r['target'] for m in primary['meanings'] for r in m['relations'] if r['relType'] in ('derivation', 'pertainym')}
    concepts = {}
    for order, offset, raw, element in xml_records(data, 'Synset'):
        concepts[element.get('id')] = {'order': order, 'offset': offset, 'raw': raw.decode(),
            'definition': element.findtext('Definition'), 'examples': [e.text for e in element.findall('Example')],
            'relations': relations(element, 'SynsetRelation')}
    contrast_ids = {r['target'] for cid in primary_concepts for r in concepts[cid]['relations'] if r['relType'] in ('hypernym', 'similar')}
    selected = []
    immediate_concepts = primary_concepts | contrast_ids
    covered_concepts = set(immediate_concepts)
    for eid, entry in entries.items():
        meanings = [m for m in entry['meanings'] if m['conceptId'] in immediate_concepts or m['id'] in family_ids]
        if meanings:
            covered_concepts.update(m['conceptId'] for m in meanings if m['id'] in family_ids)
            selected.append((eid, entry, meanings))
    # Do not expand relation targets or other meanings in these whole entries.
    output_entries, output_meanings, output_concepts = [], [], []
    for eid, entry, meanings in selected:
        output_entries.append({'source': 'oewn', 'id': eid, 'headword': entry['headword'], 'pos': entry['pos'],
            'order': entry['order'], 'raw': entry['raw'], 'rawSha256': sha(entry['raw'].encode()),
            'locator': {'xmlEntryId': eid, 'uncompressedOffset': entry['offset']},
            'role': 'candidate' if eid == scope['oewnEntry'] else 'linked', 'data': {'forms': entry['forms'],
            'uncoveredMeaningIds': [m['id'] for m in entry['meanings'] if m not in meanings]}})
        for meaning in meanings:
            concept = concepts.get(meaning['conceptId'])
            require(concept and concept['definition'], 'scoped_required_concept_missing')
            output_meanings.append({'source': 'oewn', 'entryId': eid, **meaning,
                'data': {'definition': concept['definition'], 'examples': concept['examples'],
                         'relations': meaning['relations'], 'conceptRelations': concept['relations']}})
    for cid in sorted(covered_concepts):
        require(cid in concepts, 'scoped_required_concept_missing')
        concept = concepts[cid]
        output_concepts.append({'source': 'oewn', 'id': cid, 'order': concept['order'], 'raw': concept['raw'],
            'rawSha256': sha(concept['raw'].encode()), 'data': {k: v for k, v in concept.items() if k not in ('raw',)}})
    links = []
    for meaning in primary['meanings']:
        for eid, entry, meanings in selected:
            for target in meanings:
                relation = next((r['relType'] for r in concepts[meaning['conceptId']]['relations']
                    if r['target'] == target['conceptId'] and r['relType'] in ('hypernym', 'similar')), None)
                if target['conceptId'] == meaning['conceptId'] and eid != scope['oewnEntry']:
                    relation = 'direct_member'
                if relation:
                    links.append({'source': 'oewn', 'from': meaning['id'], 'to': target['id'], 'word': entry['headword'], 'type': relation, 'purpose': 'contrast'})
                family = next((r['relType'] for r in meaning['relations'] if r['target'] == target['id'] and r['relType'] in ('derivation', 'pertainym')), None)
                if family:
                    links.append({'source': 'oewn', 'from': meaning['id'], 'to': target['id'], 'word': entry['headword'], 'type': family, 'purpose': 'family'})
    return output_entries, output_meanings, output_concepts, links


def qualifier_labels(arguments):
    """Underscores join adjacent tokens in one qualifier, including negations."""
    result, joined = [], False
    for value in arguments:
        if value == '_':
            require(bool(result) and not joined, 'scoped_qualifier_mapping_failed')
            joined = True
        elif joined:
            result[-1] += ' ' + value
            joined = False
        else:
            result.append(value)
    require(not joined, 'scoped_qualifier_mapping_failed')
    return result


def supplemental_page(path, scope):
    with read_index(path) as db:
        pages = list(db.execute('SELECT page_id,revision_id,text_sha256,raw_wikitext FROM pages WHERE title=? AND namespace=0', ('emulate',)))
    require(len(pages) == 1, 'scoped_supplemental_page_ambiguous')
    page = dict(pages[0])
    require(page['page_id'] == scope['pageId'] and page['revision_id'] == scope['revisionId'] and
            sha(page['raw_wikitext'].encode()) == scope['textSha256'] == page['text_sha256'], 'scoped_supplemental_page_changed')
    english = page['raw_wikitext'].split('==English==\n', 1)[1].split('\n==Italian==', 1)[0]
    meanings, pos = [], None
    for line_no, line in enumerate(english.splitlines(), 1):
        if line in ('===Verb===', '===Adjective==='):
            pos = line.strip('=').lower()
        if re.match(r'^# ', line):
            qualifiers = [{'template': match.group(), 'arguments': match.group(1).split('|')[1:],
                'labels': qualifier_labels(match.group(1).split('|')[2:])} for match in re.finditer(r'\{\{(lb\|[^{}]+)\}\}', line)]
            meanings.append({'pos': pos, 'line': line_no, 'raw': line, 'qualifiers': qualifiers})
    require([m['pos'] for m in meanings] == ['verb'] * 4 + ['adjective'], 'scoped_supplemental_mapping_failed')
    return {**page, 'meanings': meanings, 'authenticatesKaikki': False}


def build(root, scope, lock):
    require(scope['schema'] == 'wordwell-scoped-evidence-v1' and scope['candidates'] == ['emulate'], 'unsupported_scoped_candidates')
    snapshot = root / 'extractions' / scope['snapshot']
    trial = root / 'trials' / scope['trial']
    artifacts = []
    def artifact(source, path, expected, metadata):
        value = {'source': source, **verified(path, expected), 'metadata': metadata}
        artifacts.append(value)
        return value
    pins = {a['source']: a for a in lock['artifacts']}
    oewn_path = root / 'downloads' / pins['oewn']['filename']
    artifact('oewn', oewn_path, pins['oewn']['checksums']['sha256'], pins['oewn'])
    artifact('wordfreq_package', root / 'downloads' / pins['wordfreq']['filename'], pins['wordfreq']['checksums']['sha256'], pins['wordfreq'])
    artifact('supplemental_dump', root / 'downloads' / pins['wiktionary']['filename'], scope['supplemental']['dumpSha256'], pins['wiktionary'])
    download = read_json(trial / 'download.json')
    require(download['status'] == 'downloaded' and download['artifact']['sha256'] == scope['kaikki']['corpusSha256'], 'scoped_kaikki_download_incomplete')
    artifact('kaikki', trial / 'raw-wiktextract-data.jsonl.gz', scope['kaikki']['corpusSha256'],
        {'release': download['published'], 'url': download['remote']['url'], 'license': pins['wiktionary']['license'], 'attribution': pins['wiktionary']['attribution'], 'pageRevisionIds': None})
    artifact('kaikki_publisher', trial / 'publisher.html', download['publisherPage']['sha256'], download['publisherPage'])
    artifact('kaikki_index', trial / 'english.sqlite', scope['kaikki']['indexSha256'], {'derivedFrom': scope['kaikki']['corpusSha256']})
    for notice in sorted((root / 'notices').glob('*.json')):
        metadata = read_json(notice)
        artifact('notice', root / metadata['filename'], metadata['sha256'], metadata)
    coverage = read_json(snapshot / 'frequency-coverage.json')
    require(coverage['status'] == 'verified' and coverage['version'] == '3.1.1' and coverage['language'] == 'en' and coverage['wordlist'] == 'large' and coverage['counts']['forms'] == scope['frequency']['forms'] and coverage['output']['sha256'] == scope['frequency']['exportSha256'], 'scoped_frequency_receipt_invalid')
    artifact('frequency', snapshot / 'frequency.jsonl', scope['frequency']['exportSha256'], coverage)
    artifact('frequency_data', snapshot / 'large_en.msgpack.gz', scope['frequency']['dataSha256'], coverage['dataArtifact'])
    frequency, count = [], 0
    for line in (snapshot / 'frequency.jsonl').open():
        observation = json.loads(line)
        count += 1
        if observation['form'] == 'emulate':
            frequency.append(observation)
    require(count == scope['frequency']['forms'] and len(frequency) == 1 and frequency[0]['order'] == scope['frequency']['order'], 'scoped_frequency_coverage_failed')
    entries, meanings, concepts, links = oewn_bundle(oewn_path, scope)
    page = supplemental_page(snapshot / 'pages.sqlite', scope['supplemental'])
    with read_index(trial / 'english.sqlite') as db:
        progress = json.loads(db.execute('SELECT value FROM progress WHERE id=1').fetchone()[0])
        require(progress['complete'] and progress['artifactSha256'] == scope['kaikki']['corpusSha256'], 'scoped_index_incomplete')
        rows = list(db.execute('SELECT * FROM records WHERE word=? AND kind=? ORDER BY ordinal', ('emulate', 'english')))
    require(len(rows) == 2, 'scoped_kaikki_entries_missing')
    for row, pin in zip(rows, scope['kaikki']['records']):
        require(row['ordinal'] == pin['line'] and sha(row['raw_json'].encode()) == row['sha256'] == pin['sha256'], 'scoped_kaikki_record_changed')
        record = json.loads(row['raw_json'])
        require(record['word'] == 'emulate' and record['lang_code'] == 'en' and record['pos'] in ('verb', 'adj'), 'scoped_kaikki_identity_failed')
        eid = 'line:' + str(row['ordinal'])
        entries.append({'source': 'kaikki', 'id': eid, 'headword': record['word'], 'pos': record['pos'], 'order': row['ordinal'],
            'role': 'candidate', 'raw': row['raw_json'], 'rawSha256': row['sha256'],
            'locator': {'line': row['ordinal'], 'uncompressedOffset': row['uncompressed_offset'], 'pageId': None, 'revisionId': None}, 'data': record})
        for order, meaning in enumerate(record['senses'], 1):
            require(meaning.get('glosses'), 'scoped_kaikki_gloss_missing')
            meanings.append({'source': 'kaikki', 'entryId': eid, 'id': eid + ':meaning:' + str(order), 'order': order, 'conceptId': None, 'relations': [], 'data': meaning})
        for derived in record.get('derived', []):
            links.append({'source': 'kaikki', 'from': eid, 'to': derived['word'], 'word': derived['word'], 'type': 'derived', 'purpose': 'family', 'data': derived})
    require(sum(m['source'] == 'kaikki' for m in meanings) == 5, 'scoped_kaikki_inventory_failed')
    require({r['word'] for r in links if r['source'] == 'kaikki'} == {'unemulated', 'emulatable', 'emulatory', 'emulable', 'emulative', 'emulator', 'emulation'}, 'scoped_family_mapping_failed')
    diagnostics = [
        {'code': 'raw_now_rare_vs_normalized_archaic', 'impact': 'mapped_separately', 'source': 'kaikki:line:34324:meaning:1', 'supplemental': 'page:7577:92422846'},
        {'code': 'publisher_revision_unknown', 'impact': 'accepted_scoped_limitation', 'reason': 'Publisher line/hash identity is approved; supplemental page does not authenticate it.'},
        {'code': 'linked_targets_not_recursively_imported', 'impact': 'outside_declared_scope', 'reason': 'Whole records retain other relations and meanings; only declared immediate support is covered.'},
        {'code': 'external_quotations', 'impact': 'retained_not_generation', 'reason': 'Whole quotation metadata remains evidence; no quotation enters generation projection.'},
        {'code': 'complete_corpus_not_ready', 'impact': 'separate_acceptance', 'reason': 'The interrupted local extraction and corpus-wide mapping acceptance are not selected.'}
    ]
    return {'scope': scope, 'artifacts': artifacts, 'entries': entries, 'meanings': meanings, 'concepts': concepts,
            'relations': links, 'frequency': frequency[0], 'supplemental': page, 'diagnostics': diagnostics,
            'coverage': {'candidates': ['emulate'], 'fullCorpus': False, 'oewnMeanings': 3, 'kaikkiMeanings': 5}, 'modelCalls': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path(os.environ.get('WORDWELL_SOURCE_DIR', DEFAULT_ROOT)))
    parser.add_argument('--scope', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--input-json', action='store_true', help='Read frozen scope and manifest from stdin')
    args = parser.parse_args()
    try:
        if args.input_json:
            inputs = json.load(sys.stdin)
        else:
            require(args.scope and args.manifest, 'scoped_configuration_required')
            inputs = {'scope': read_json(args.scope), 'manifest': read_json(args.manifest)}
        print(json.dumps(build(outside_checkout(args.directory), inputs['scope'], inputs['manifest']), ensure_ascii=False))
    except Exception as error:
        print(str(error) if isinstance(error, PreparationError) else 'scoped_evidence_unavailable', file=sys.stderr)
        sys.exit(1)
