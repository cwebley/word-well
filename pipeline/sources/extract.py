"""Instrument the pinned extractor with page identity, bounded work and checkpoints.

Wiktextract's entry parser and template analysis remain the extraction engine.
The adapter owns ingestion provenance, scheduling, diagnostics and artifact readiness.
"""

import argparse
import bz2
from contextlib import closing
from collections import Counter, deque
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
import gzip
import hashlib
import importlib.resources
import json
import multiprocessing
import os
from pathlib import Path
import re
import sqlite3
import signal
import sys
import threading
import time
import traceback
from urllib.parse import urlsplit

from prepare import PreparationError, atomic_json, file_identity, identity, read_json

ADAPTER_VERSION = "wordwell-wiktionary-adapter-v1"
WORKER = None
WORKER_LOG = None


class DigestingWriter:
    def __init__(self, output, digest):
        self.output, self.digest = output, digest

    def write(self, value):
        self.digest.update(value.encode("utf-8"))
        return self.output.write(value)

    def __getattr__(self, name):
        return getattr(self.output, name)


def json_line(output, value):
    output.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def sync_outputs(outputs):
    for output in outputs:
        output.flush()
        os.fsync(output.fileno())


def record_network(directory):
    """Retain auxiliary GET responses, including failures, for exact reruns.

    This is only installed inside the source subprocess. No model endpoints exist
    on its allowlist. Responses form part of the completed snapshot's evidence.
    """
    import requests
    original = requests.Session.send

    def send(session, request, **kwargs):
        if request.method != "GET" or urlsplit(request.url).hostname not in {
            "en.wiktionary.org", "query.wikidata.org", "www.wikidata.org"
        }:
            raise PreparationError("unexpected_source_network_request")
        key = identity({"method": request.method, "url": request.url})
        path = directory / (key + ".json")
        if path.exists():
            saved = read_json(path)
            response = requests.Response()
            response.status_code = saved["status"]
            response._content = bytes.fromhex(saved["bodyHex"])
            response.headers.update(saved["headers"])
            response.url = request.url
            response.request = request
            response.encoding = saved["encoding"]
            return response
        kwargs["timeout"] = 120
        response = original(session, request, **kwargs)
        saved = {"method": request.method, "url": request.url, "status": response.status_code,
                 "headers": dict(response.headers), "encoding": response.encoding,
                 "bodyHex": response.content.hex(), "bodySha256": hashlib.sha256(response.content).hexdigest()}
        # Atomic publication permits parallel lookups. The selected bytes are
        # reused by all later lookups. Different first responses remain in logs.
        temporary = path.with_name(f"{key}.{os.getpid()}.part")
        temporary.write_text(json.dumps(saved))
        try:
            os.link(temporary, path)
        except FileExistsError:
            # Return the selected response, not a racing response with different bytes.
            return send(session, request, **kwargs)
        finally:
            temporary.unlink()
        return response

    requests.Session.send = send


def context(database):
    from wikitextprocessor import Wtp
    from wiktextract.config import WiktionaryConfig
    from wiktextract.template_override import template_override_fns
    from wiktextract.wxr_context import WiktextractContext
    config = WiktionaryConfig(
        dump_file_lang_code="en", capture_language_codes={"en"},
        capture_translations=True, capture_pronunciation=True, capture_linkages=True,
        capture_compounds=True, capture_redirects=True, capture_examples=True,
        capture_etymologies=True, capture_inflections=True, capture_descendants=True,
    )
    wtp = Wtp(db_path=database, lang_code="en", template_override_funcs=template_override_fns,
              extension_tags=config.allowed_html_tags,
              parser_function_aliases=config.parser_function_aliases, quiet=True)
    return WiktextractContext(wtp, config)


def ingest(wxr, dump, directory):
    """A single streaming XML pass retains original pages and revision metadata.

    The original source text remains here even where Wtp transforms template
    transclusion bodies or installs its bundled template overrides.
    """
    with closing(sqlite3.connect(directory / "pages.sqlite")) as companion:
        return ingest_pages(wxr, dump, directory, companion)


def ingest_pages(wxr, dump, directory, companion):
    from lxml import etree
    from wikitextprocessor.dumpparser import add_default_templates, analyze_and_overwrite_pages
    from wiktextract.import_utils import import_extractor_module
    companion.executescript("""
        CREATE TABLE pages (
          ordinal INTEGER PRIMARY KEY, page_id TEXT NOT NULL,
          revision_id TEXT NOT NULL, revision_timestamp TEXT NOT NULL,
          title TEXT NOT NULL, namespace INTEGER NOT NULL, model TEXT NOT NULL,
          redirect TEXT, text_sha256 TEXT NOT NULL, raw_wikitext TEXT NOT NULL,
          stored INTEGER NOT NULL
        );
        CREATE INDEX page_title_namespace ON pages(title, namespace);
        CREATE INDEX page_identity ON pages(page_id, revision_id);
    """)
    namespaces = {wxr.wtp.NAMESPACE_DATA.get(name, {}).get("id", 0)
                  for name in wxr.config.save_ns_names}
    counts = Counter()
    # Use Python's checked BZ2 reader, not upstream's unchecked subprocess exit.
    with bz2.open(dump, "rb") as source:
        for ordinal, (_, page) in enumerate(etree.iterparse(source, events=("end",), tag="{*}page"), 1):
            title = page.findtext("{*}title", "")
            namespace = int(page.findtext("{*}ns", "0"))
            revision_id = page.findtext("{*}revision/{*}id", "")
            page_id = page.findtext("{*}id", "")
            timestamp = page.findtext("{*}revision/{*}timestamp", "")
            model = page.findtext("{*}revision/{*}model", "")
            raw = page.findtext("{*}revision/{*}text", "")
            redirect_element = page.find("{*}redirect")
            redirect = redirect_element.get("title", "") if redirect_element is not None else None
            stored = namespace in namespaces and not title.endswith("/documentation") and "/testcases" not in title
            stored = stored and (redirect is not None or model in {"wikitext", "Scribunto", "json"})
            if not page_id or not revision_id or not timestamp:
                raise PreparationError("missing_dump_page_identity")
            companion.execute("INSERT INTO pages VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                              (ordinal, page_id, revision_id, timestamp, title, namespace, model,
                               redirect, hashlib.sha256(raw.encode()).hexdigest(), raw, int(stored)))
            if stored:
                wxr.wtp.add_page(title, namespace, body=raw if redirect is None else None,
                                 redirect_to=redirect, model=model)
                counts[f"stored_namespace_{namespace}"] += 1
            counts["dump_pages"] += 1
            page.clear(keep_tail=True)
            # Remove consumed siblings. clear() alone leaves millions of elements.
            while page.getprevious() is not None:
                del page.getparent()[0]
            if ordinal % 10000 == 0:
                companion.commit()
                wxr.wtp.db_conn.commit()
                atomic_json(directory / "ingestion-progress.json", dict(counts))
    companion.commit()
    # Exact stored-title coverage check before adding defaults and overrides.
    wxr.wtp.db_conn.commit()
    companion.execute("ATTACH DATABASE ? AS resource", (str(wxr.wtp.db_path),))
    missing = companion.execute("""SELECT count(*) FROM pages p LEFT JOIN resource.pages r
         ON p.title=r.title AND p.namespace=r.namespace_id
         WHERE p.stored=1 AND r.title IS NULL""").fetchone()[0]
    if missing:
        raise PreparationError("missing_ingested_resources")
    counts["missing_ingested_resources"] = missing
    companion.execute("DETACH DATABASE resource")
    counts["repeated_resource_titles"] = companion.execute("""SELECT coalesce(sum(n-1),0) FROM
        (SELECT count(*) n FROM pages WHERE stored=1 GROUP BY title,namespace HAVING count(*)>1)""").fetchone()[0]
    counts["repeated_page_ids"] = companion.execute("""SELECT coalesce(sum(n-1),0) FROM
        (SELECT count(*) n FROM pages GROUP BY page_id HAVING count(*)>1)""").fetchone()[0]
    if counts["repeated_resource_titles"]:
        with (directory / "resource-title-conflicts.jsonl").open("w") as conflicts:
            for row in companion.execute("""SELECT p.ordinal,p.page_id,p.revision_id,p.title,p.namespace,p.text_sha256
                FROM pages p JOIN (SELECT title,namespace FROM pages WHERE stored=1
                GROUP BY title,namespace HAVING count(*)>1) d
                ON p.title=d.title AND p.namespace=d.namespace WHERE p.stored=1 ORDER BY p.ordinal"""):
                json_line(conflicts, dict(zip(("ordinal","pageId","revisionId","title","namespace","textSha256"),row)))
    companion.close()
    counts["companion_bytes"] = (directory / "pages.sqlite").stat().st_size
    analyze = import_extractor_module("en", "analyze_template")
    override = importlib.resources.files("wiktextract") / "data/overrides/en.json"
    # Phase one already ingested XML. Run upstream's interwiki/default/template
    # analysis operations explicitly; nonempty SQLite is never a completion marker.
    from wikitextprocessor.interwiki import init_interwiki_map
    init_interwiki_map(wxr.wtp)
    add_default_templates(wxr.wtp)
    analyze_and_overwrite_pages(wxr.wtp, [Path(str(override))] if override.is_file() else None,
                               skip_extract_dump=False,
                               analyze_template_func=analyze.analyze_template if analyze else None)
    return dict(counts)


def init_worker(database, directory):
    global WORKER, WORKER_LOG
    directory = Path(directory)
    WORKER_LOG = (directory / f"worker-{os.getpid()}.log").open("a", buffering=1, encoding="utf-8")
    sys.stdout = WORKER_LOG
    sys.stderr = WORKER_LOG
    record_network(directory / "network")
    WORKER = context(Path(database))
    import atexit
    atexit.register(WORKER.remove_unpicklable_objects)


def parse_batch(batch, thesaurus):
    from wiktextract.page import parse_page
    from wiktextract.thesaurus import extract_thesaurus_page
    from wiktextract.wiktionary import check_json_data
    from wikitextprocessor import Page
    results = []
    for metadata, body in batch:
        title = metadata["title"]
        WORKER.wtp.start_page(title)
        WORKER.config.debugs.clear()
        try:
            if thesaurus:
                page = Page(title=title, namespace_id=metadata["namespace"], body=body,
                            redirect_to=None, need_pre_expand=False, model="wikitext")
                records = [asdict(term) for term in extract_thesaurus_page(WORKER, page)]
            elif metadata["redirect"] is not None:
                records = [{"title": title, "redirect": metadata["redirect"], "pos": "hard-redirect"}]
            else:
                clean_title = re.sub(r"[\s\000-\037]+", " ", title).strip()
                records = parse_page(WORKER, clean_title, body)
                for record in records:
                    check_json_data(WORKER, record)
            diagnostics = WORKER.wtp.to_return()
            diagnostics["validation"] = list(WORKER.config.debugs)
            results.append((metadata, records, diagnostics, None))
        except Exception:
            results.append((metadata, [], WORKER.wtp.to_return(), traceback.format_exc()))
    return results


def page_batches(directory, namespaces, after, batch_size=25, thesaurus=False):
    connection = sqlite3.connect(directory / "pages.sqlite")
    connection.row_factory = sqlite3.Row
    try:
        query = f"SELECT * FROM pages WHERE stored=1 AND model='wikitext' AND namespace IN ({','.join('?' for _ in namespaces)}) AND ordinal>? ORDER BY ordinal"
        if thesaurus:
            query = query.replace("ORDER BY ordinal", "AND redirect IS NULL ORDER BY ordinal")
        batch = []
        for row in connection.execute(query, [*namespaces, after]):
            data = dict(row)
            body = data.pop("raw_wikitext")
            batch.append((data, body))
            if len(batch) == batch_size:
                yield batch
                batch = []
        if batch:
            yield batch
    finally:
        connection.close()


def selection_namespaces(wxr, thesaurus):
    return [wxr.wtp.NAMESPACE_DATA["Thesaurus"]["id"]] if thesaurus else [
        wxr.wtp.NAMESPACE_DATA[name]["id"] for name in wxr.config.extract_ns_names
    ]


def bounded_results(executor, batches, thesaurus, workers):
    """At most four batches per worker are submitted, including large page bodies."""
    pending = deque()
    iterator = iter(batches)
    for _ in range(workers * 4):
        batch = next(iterator, None)
        if batch is None:
            break
        pending.append(executor.submit(parse_batch, batch, thesaurus))
    while pending:
        yield pending.popleft().result()
        batch = next(iterator, None)
        if batch is not None:
            pending.append(executor.submit(parse_batch, batch, thesaurus))


def process_pages(wxr, directory, workers, thesaurus):
    from wiktextract.thesaurus import ThesaurusTerm, insert_thesaurus_term
    phase = "thesaurus" if thesaurus else "dictionary"
    namespaces = selection_namespaces(wxr, thesaurus)
    checkpoint_path = directory / (phase + "-checkpoint.json")
    checkpoint = read_json(checkpoint_path) if checkpoint_path.exists() else {
        "ordinal": 0, "offset": 0, "diagnosticOffset": 0,
        "outputSha256": hashlib.sha256(b"").hexdigest(), "diagnosticSha256": hashlib.sha256(b"").hexdigest(),
        "counts": {"pages": 0, "records": 0, "failedPages": 0, "unresolvedDiagnostics": 0},
        "diagnosticGroups": {}, "complete": False,
    }
    output_path = directory / (phase + ".jsonl")
    diagnostic_path = directory / (phase + "-diagnostics.jsonl")
    # A committed batch records fsynced byte offsets. Discard only uncommitted tails.
    hashes = []
    for path, offset, expected in [(output_path, checkpoint["offset"], checkpoint["outputSha256"]),
                                   (diagnostic_path, checkpoint["diagnosticOffset"], checkpoint["diagnosticSha256"])]:
        if not path.exists() and offset:
            raise PreparationError("checkpoint_output_missing")
        with path.open("ab") as output:
            if output.tell() < offset:
                raise PreparationError("checkpoint_output_truncated")
            output.truncate(offset)
        hasher = hashlib.sha256()
        with path.open("rb") as source:
            while chunk := source.read(4 * 1024 * 1024):
                hasher.update(chunk)
        if hasher.hexdigest() != expected:
            raise PreparationError("checkpoint_output_changed")
        hashes.append(hasher)
    if checkpoint["complete"]:
        return checkpoint
    wxr.remove_unpicklable_objects()
    with output_path.open("a", encoding="utf-8") as output_file, diagnostic_path.open("a", encoding="utf-8") as diagnostic_file:
        output, diagnostics = DigestingWriter(output_file, hashes[0]), DigestingWriter(diagnostic_file, hashes[1])
        with ProcessPoolExecutor(max_workers=workers, mp_context=multiprocessing.get_context("spawn"),
                                 initializer=init_worker,
                                 initargs=(str(wxr.wtp.db_path), str(directory))) as executor:
            wxr.reconnect_databases()
            for batch in bounded_results(executor, page_batches(directory, namespaces, checkpoint["ordinal"], thesaurus=thesaurus), thesaurus, workers):
                for metadata, records, stats, failure in batch:
                    checkpoint["counts"]["pages"] += 1
                    checkpoint["counts"]["failedPages"] += int(failure is not None)
                    for order, record in enumerate(records, 1):
                        if thesaurus:
                            insert_thesaurus_term(wxr.thesaurus_db_conn, ThesaurusTerm(**record))
                            if record["language_code"] != "en":
                                continue
                        elif record.get("lang_code") not in (None, "en"):
                            raise PreparationError("unexpected_extracted_language")
                        json_line(output, {"page": metadata, "entryOrder": order, "record": record})
                        checkpoint["counts"]["records"] += 1
                    json_line(diagnostics, {"pageOrdinal": metadata["ordinal"], "pageId": metadata["page_id"],
                                            "recordCount": len(records), "failure": failure, "diagnostics": stats})
                    for kind in ("errors", "warnings", "debugs", "notes", "wiki_notices", "validation"):
                        for diagnostic in stats.get(kind, []):
                            key = kind + ":" + str(diagnostic.get("called_from", "unknown"))
                            checkpoint["diagnosticGroups"][key] = checkpoint["diagnosticGroups"].get(key, 0) + 1
                            # Diagnostics are retained without upstream aggregate caps.
                            # Unknown impact never becomes an automatic coverage pass.
                            checkpoint["counts"]["unresolvedDiagnostics"] += 1
                    checkpoint["ordinal"] = metadata["ordinal"]
                wxr.thesaurus_db_conn.commit()
                sync_outputs([output, diagnostics])
                checkpoint["offset"] = output.tell()
                checkpoint["diagnosticOffset"] = diagnostics.tell()
                checkpoint["outputSha256"] = output.digest.hexdigest()
                checkpoint["diagnosticSha256"] = diagnostics.digest.hexdigest()
                atomic_json(checkpoint_path, checkpoint)
    checkpoint["complete"] = True
    atomic_json(checkpoint_path, checkpoint)
    return checkpoint


class Resources:
    """Sample source-process-tree RSS and allocated artifact disk bytes."""
    def __init__(self, root, directory):
        self.root, self.directory = root, directory
        self.stop = threading.Event()
        self.started = time.monotonic()
        previous = read_json(directory / "resources.json") if (directory / "resources.json").exists() else {}
        self.previous_elapsed = previous.get("elapsedSeconds", 0)
        self.samples = previous.get("samples", 0)
        self.peak_rss = previous.get("peakProcessTreeRssBytes", 0)
        self.peak_disk = previous.get("peakAllocatedSourceDiskBytes", 0)
        self.error = None
        self.thread = threading.Thread(target=self.sample, daemon=True)

    def sample(self):
        import psutil
        process = psutil.Process()
        while True:
            rss = 0
            for child in [process, *process.children(recursive=True)]:
                try:
                    rss += child.memory_info().rss
                except psutil.Error:
                    pass
            disk = 0
            for path in self.root.rglob("*"):
                try:
                    if path.is_file() and not path.is_symlink():
                        disk += path.stat().st_blocks * 512
                except FileNotFoundError:
                    pass
            self.samples += 1
            self.peak_rss = max(self.peak_rss, rss)
            self.peak_disk = max(self.peak_disk, disk)
            atomic_json(self.directory / "resources.json", {
                "elapsedSeconds": self.previous_elapsed + time.monotonic() - self.started,
                "peakProcessTreeRssBytes": self.peak_rss, "peakAllocatedSourceDiskBytes": self.peak_disk,
                "samples": self.samples, "samplingIntervalSeconds": 5,
                "measurement": "sampled RSS sum; shared pages may be counted per process; source directory disk only",
            })
            if self.stop.wait(5):
                break

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join()


def run(root, directory, workers):
    os.environ["NLTK_DATA"] = str(root / "toolchain/nltk_data")
    temporary = directory / "tmp"
    temporary.mkdir(exist_ok=True)
    os.environ["TMPDIR"] = str(temporary)
    os.environ["SQLITE_TMPDIR"] = str(temporary)
    network = directory / "network"
    network.mkdir(exist_ok=True)
    record_network(network)
    state_path = directory / "state.json"
    state = read_json(state_path)
    state["status"] = "running"
    state["pid"] = os.getpid()
    atomic_json(state_path, state)
    wxr = None
    try:
        with Resources(root, directory):
            from inventories import oewn, frequency
            if not (directory / "oewn-coverage.json").exists():
                oewn(root, directory)
            if not (directory / "frequency-coverage.json").exists():
                frequency(root, directory)
            wxr = context(directory / "resources.sqlite")
            ingestion = directory / "ingestion.json"
            if not ingestion.exists():
                if (directory / "pages.sqlite").exists():
                    raise PreparationError("incomplete_ingestion_start_new_extraction")
                counts = ingest(wxr, root / "downloads/enwiktionary-20260901-pages-articles.xml.bz2", directory)
                wxr.wtp.db_conn.commit()
                atomic_json(ingestion, {"status": "complete", "counts": counts,
                                       "companion": file_identity(directory / "pages.sqlite")})
            state["phase"] = "thesaurus"
            atomic_json(state_path, state)
            state["thesaurus"] = process_pages(wxr, directory, workers, True)
            state["phase"] = "dictionary"
            atomic_json(state_path, state)
            state["dictionary"] = process_pages(wxr, directory, workers, False)
            state["selection"] = {"dictionaryNamespaces": selection_namespaces(wxr, False),
                                  "thesaurusNamespaces": selection_namespaces(wxr, True)}
            wxr.remove_unpicklable_objects()
            wxr = None
            # Stable external artifacts are identified only after writers close.
            state["artifacts"] = {name: file_identity(directory / name) for name in
                                  ("pages.sqlite", "resources.sqlite", "resources_thesaurus.sqlite",
                                   "frequency.jsonl", "frequency-coverage.json", "oewn-coverage.json")}
            conflict_path = directory / "resource-title-conflicts.jsonl"
            if conflict_path.exists():
                state["artifacts"][conflict_path.name] = file_identity(conflict_path)
            frequency_manifest = read_json(directory / "frequency-coverage.json")
            name = frequency_manifest["dataArtifact"]["filename"]
            state["artifacts"][name] = file_identity(directory / name)
            state["networkArtifacts"] = {path.name: file_identity(path) for path in sorted(network.glob("*.json"))}
            state["status"] = "extracted_needs_coverage_review"
            state["phase"] = "coverage_review"
            state["modelCalls"] = 0
            atomic_json(state_path, state)
    except BaseException:
        state["status"] = "failed"
        atomic_json(state_path, state)
        traceback.print_exc()
        raise
    finally:
        if wxr is not None:
            wxr.remove_unpicklable_objects()


if __name__ == "__main__":
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    run(args.root, args.directory, args.workers)
