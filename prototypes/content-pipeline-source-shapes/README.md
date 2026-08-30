# PROTOTYPE — source shapes and candidate pool, spike #44

Throwaway. Two halves, two findings documents:

| Half | What it answers | Findings |
|---|---|---|
| Source shapes | do the four assumptions behind the intake design survive real records? | `docs/research/content-pipeline-source-shapes.md` |
| Candidate pool | where do candidate words come from, and what narrows them to words worth teaching? | `docs/research/candidate-pool-and-intake-filters.md` |

No schema, no migrations, no pipeline code. SQLite deliberately, so none of this
can quietly become the production model. Every filter is a **column**, never a
deletion, so the browser can turn each one on and off.

## Files

**Source shapes** — 33 hand-picked words from #44 against every approved source.

| File | What it does |
|---|---|
| `words.txt` | the 33-word list from #44, unchanged |
| `fetch_wiktionary.py` | wikitext + revid per word via the MediaWiki API |
| `extract.py` | one record per word: OEWN senses, CMUdict, SCOWL tier, Zipf |
| `parse_wiktionary.py` | usage-label density and where labels attach |
| `arpabet.py` | naive ARPAbet→IPA, to show where it stops being mechanical |
| `fetch_wotd.py` | Wiktionary Word of the Day headwords, 2024–2026 |
| `measure_nominations.py` | nomination resolution rate through the intake gates |
| `records.json`, `wiktionary-labels.json`, `nom-*.json`, `wiktionary-manifest.json` | extracted output and provenance |

**Candidate pool** — all of wordfreq reduced to lemmas and filtered.

| File | What it does |
|---|---|
| `build_pool.py` | wordfreq → OEWN lemmas, frequency summed over inflected forms, every filter scored as a column |
| `fetch_labels.py` | Wiktionary register and topical labels, survivors only (~130 requests, not ~970) |
| `build_browser.py` | emits the self-contained `band-browser-prototype.html` |
| `pool.sqlite` | 50,860 lemmas with all filter columns |

## Run

```sh
python3 -m venv venv && ./venv/bin/pip install wordfreq wn requests
export WN_DATA_DIR="$PWD/data/wn"
./venv/bin/python -c "import wn; wn.download('oewn:2025')"
curl -sSL -o data/cmudict.dict https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict
curl -sSL -o data/scowl.tar.gz https://downloads.sourceforge.net/wordlist/scowl-2020.12.07.tar.gz
tar xzf data/scowl.tar.gz -C data
```

Then `build_pool.py` (~60s), `fetch_labels.py` (~3m), `build_browser.py`.

Raw snapshots are not committed — 107 MB of OEWN index, ~6 MB of CMUdict and
SCOWL, 384 KB of wikitext. The extracted JSON is, so the numbers in both findings
docs can be checked without re-downloading.

`pool.sqlite` is **not** committed either, despite what an earlier version of
this file claimed. It is a build output: rebuild it with `rebuild_all.sh`. Any
evidence manifest derived from it records its sha256, so a run can tell whether
it was built against a different pool.

## Current settings

Bands: floor **1.0**, cuts at **2.15** and **2.60**, ceiling **3.05**.
34,021 lemmas in range, **5,428** surviving the default filters.

Two filters ship **off** by default and are wrong to turn on without reading why:
`no synonyms` (removes `ethos`, `empathy`, `impunity`, `internecine`) and
`derived — meaning may shift` (removes `industrious`, `beneficent`,
`vertiginous`).

## Known gaps

- Etymology sections are flattened. Wiktionary attaches etymology to a numbered
  Etymology group spanning several POS blocks, not to a sense.
- Template-only glosses parse empty (`byzantine`'s adjective sense).
- `wordfreq` returns `0.00` both for "absent from the wordlist" and "vanishingly
  rare". 26% of OEWN lemmas are absent entirely, `vituperate` among them.
- Blind affix-stripping invents morphology: `preachy` ← `achy`, `rebut` ← `but`.
  `rebut` is currently lost to this.
- Language and ethnonym names (`caddoan`, `pashtu`) sit in `noun.communication`
  and pass the abstract filter.
- Frequency is a *difficulty* axis. Nothing here measures whether a word is
  worth teaching, and three places now have a measured need for a judge:
  synonym junk, derivation drift, content appropriateness.
