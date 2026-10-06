"""Local acquisition trial. Never changes approved pins or source readiness."""

import argparse
from collections import Counter
import gzip
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import sys
import time
import urllib.request

from prepare import (DEFAULT_ROOT, PreparationError, atomic_json, file_identity,
                     outside_checkout, read_json, source_lock)

URL = "https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz"
PAGE = "https://kaikki.org/dictionary/rawdata.html"
VERSION = "wordwell-kaikki-trial-v1"
CHUNK = 32 * 1024 * 1024
SAMPLES = ("emulate", "colour", "tee", "café")


def request(url, **kwargs):
    headers = {"User-Agent": "WordWell-source-trial/1", "Accept-Encoding": "identity"}
    headers.update(kwargs.pop("headers", {}))
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers, **kwargs), timeout=120)


def remote_identity(url):
    with request(url, method="HEAD") as response:
        etag = response.headers.get("ETag")
        if not etag or etag.startswith("W/"):
            raise PreparationError("trial_requires_strong_remote_etag")
        return {"url": url, "bytes": int(response.headers["Content-Length"]),
                "etag": etag, "lastModified": response.headers.get("Last-Modified")}


def check_prefix(path, chunks, truncate=True):
    """Reject altered committed bytes and discard only an interrupted tail."""
    offset = 0
    with path.open("a+b" if truncate else "rb") as output:
        output.seek(0)
        for chunk in chunks:
            data = output.read(chunk["bytes"])
            if hashlib.sha256(data).hexdigest() != chunk["sha256"] or len(data) != chunk["bytes"]:
                raise PreparationError("trial_download_prefix_changed")
            offset += len(data)
        if truncate:
            output.truncate(offset)
            output.flush()
            os.fsync(output.fileno())
        elif output.read(1):
            raise PreparationError("trial_download_uncommitted_completed_file")
    return offset


def fetch(directory, url=URL):
    manifest_path = directory / "download.json"
    target = directory / "raw-wiktextract-data.jsonl.gz"
    partial = target.with_suffix(".gz.part")
    if manifest_path.exists():
        manifest = read_json(manifest_path)
        if manifest["remote"]["url"] != url:
            raise PreparationError("trial_download_url_changed")
        if manifest["status"] == "downloaded":
            if file_identity(target) != manifest["artifact"]:
                raise PreparationError("trial_download_changed")
            print(json.dumps({"phase": "download_reused", "artifact": manifest["artifact"]}), flush=True)
            return
    else:
        remote = remote_identity(url)
        manifest = {"schema": VERSION, "remote": remote, "status": "downloading", "chunks": [],
                    "elapsedSeconds": 0, "modelCalls": 0}
        if url == URL:
            with request(PAGE) as response:
                page = response.read()
            (directory / "publisher.html").write_bytes(page)
            manifest["publisherPage"] = {"url": PAGE, **file_identity(directory / "publisher.html")}
            # These published identities were checked in the retained page before this trial.
            published = {"dumpDate": "2026-09-02", "extractionDate": "2026-10-03",
                         "wiktextract": "1a05e46f9efbccda6a2b2f8e21b30a9c0c46513a",
                         "wikitextprocessor": "e3d6d4edb77618f4d6680edc66e3f774bea59820"}
            if any(value.encode() not in page for value in published.values()):
                raise PreparationError("trial_published_identity_changed_review_page")
            manifest["published"] = published
        atomic_json(manifest_path, manifest)
    if remote_identity(url) != manifest["remote"]:
        raise PreparationError("trial_remote_changed_preserve_partial_start_separate_trial")
    # A completed download can be recovered after the rename but before manifest publication.
    if target.exists():
        if partial.exists():
            raise PreparationError("trial_download_has_two_candidates")
        offset = check_prefix(target, manifest["chunks"], truncate=False)
        if target.stat().st_size != manifest["remote"]["bytes"]:
            raise PreparationError("trial_download_size_changed")
    else:
        offset = check_prefix(partial, manifest["chunks"])
    started = time.monotonic()
    try:
        while offset < manifest["remote"]["bytes"]:
            end = min(offset + CHUNK, manifest["remote"]["bytes"]) - 1
            with request(url, headers={"Range": f"bytes={offset}-{end}",
                                       "If-Match": manifest["remote"]["etag"]}) as response:
                expected = f"bytes {offset}-{end}/{manifest['remote']['bytes']}"
                if response.status != 206 or response.headers.get("Content-Range") != expected:
                    raise PreparationError("trial_server_did_not_return_requested_range")
                if response.headers.get("ETag") != manifest["remote"]["etag"]:
                    raise PreparationError("trial_remote_changed_during_download")
                data = response.read(end - offset + 2)
            if len(data) != end - offset + 1:
                raise PreparationError("trial_download_chunk_incomplete")
            with partial.open("ab") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            manifest["chunks"].append({"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            offset += len(data)
            atomic_json(manifest_path, manifest)
            print(json.dumps({"phase": "download", "bytes": offset, "totalBytes": manifest["remote"]["bytes"],
                              "sessionSeconds": round(time.monotonic() - started, 2)}), flush=True)
        if not target.exists():
            partial.replace(target)
        manifest["artifact"] = file_identity(target)
        manifest["status"] = "downloaded"
    finally:
        manifest["elapsedSeconds"] += time.monotonic() - started
        atomic_json(manifest_path, manifest)
    print(json.dumps({"phase": "downloaded", "elapsedSeconds": manifest["elapsedSeconds"],
                      "artifact": manifest["artifact"]}), flush=True)


def open_index(path, digest):
    code_digest = file_identity(Path(__file__))["sha256"]
    connection = sqlite3.connect(path)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=FULL")
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS records (
          ordinal INTEGER PRIMARY KEY, uncompressed_offset INTEGER NOT NULL,
          word TEXT NOT NULL, lang_code TEXT, pos TEXT, kind TEXT NOT NULL,
          raw_json TEXT NOT NULL, sha256 TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS records_word ON records(word,kind,ordinal);
        CREATE TABLE IF NOT EXISTS progress (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    """)
    saved = connection.execute("SELECT value FROM progress WHERE id=1").fetchone()
    if saved:
        checkpoint = json.loads(saved[0])
        if (checkpoint["artifactSha256"] != digest or checkpoint["version"] != VERSION
                or checkpoint.get("indexerSha256") != code_digest):
            connection.close()
            raise PreparationError("trial_index_input_changed")
    else:
        checkpoint = {"artifactSha256": digest, "version": VERSION, "indexerSha256": code_digest,
                      "offset": 0, "ordinal": 0,
                      "counts": {}, "complete": False, "elapsedSeconds": 0, "replaySeconds": 0}
        connection.execute("INSERT INTO progress VALUES(1,?)", (json.dumps(checkpoint),))
        connection.commit()
    return connection, checkpoint


def index_stream(connection, checkpoint, source, limit=None, batch_size=10000):
    """Original records and the stream cursor commit in the same transaction."""
    started = time.monotonic()
    source.seek(checkpoint["offset"])
    replay = time.monotonic() - started
    previous_elapsed = checkpoint["elapsedSeconds"]
    previous_replay = checkpoint["replaySeconds"]
    counts = Counter(checkpoint["counts"])
    processed = 0

    def commit(complete=False):
        checkpoint.update(counts=dict(counts), complete=complete,
                          elapsedSeconds=previous_elapsed + time.monotonic() - started,
                          replaySeconds=previous_replay + replay)
        connection.execute("UPDATE progress SET value=? WHERE id=1", (json.dumps(checkpoint),))
        connection.commit()

    try:
        while True:
            offset = source.tell()
            line = source.readline()
            if not line:
                commit(complete=True)
                break
            record = json.loads(line)
            if not isinstance(record, dict):
                raise PreparationError("trial_record_not_object")
            checkpoint["ordinal"] += 1
            counts["sourceRecords"] += 1
            if record.get("lang_code") == "en":
                kind = "english"
                counts["englishRecords"] += 1
                counts["englishMeanings"] += len(record.get("senses", []))
            elif record.get("pos") == "hard-redirect" or (
                    "redirect" in record and not record.get("lang_code")):
                kind = "redirect"
                counts["neutralRedirects"] += 1
            else:
                kind = None
                counts["filteredOtherRecords"] += 1
                if not record.get("lang_code"):
                    counts["filteredWithoutLanguage"] += 1
            if kind:
                word = record.get("word", record.get("title"))
                if not isinstance(word, str) or (not word and kind == "english"):
                    raise PreparationError("trial_record_word_missing")
                if not word:
                    # The publisher has a neutral redirect with an empty title.
                    # Retain its line identity and original bytes; never invent a word.
                    counts["emptyRedirectTitles"] += 1
                connection.execute("INSERT INTO records VALUES(?,?,?,?,?,?,?,?)",
                                   (checkpoint["ordinal"], offset, word, record.get("lang_code"),
                                    record.get("pos"), kind, line.decode("utf-8"), hashlib.sha256(line).hexdigest()))
            checkpoint["offset"] = source.tell()
            processed += 1
            if processed % batch_size == 0:
                commit()
                print(json.dumps({"phase": "index", "ordinal": checkpoint["ordinal"],
                                  "counts": dict(counts), "elapsedSeconds": checkpoint["elapsedSeconds"]}), flush=True)
            if limit and processed >= limit:
                commit()
                break
    except BaseException:
        connection.rollback()
        raise
    return checkpoint


def index(directory, limit=None):
    manifest = read_json(directory / "download.json")
    target = directory / "raw-wiktextract-data.jsonl.gz"
    if manifest["status"] != "downloaded" or file_identity(target) != manifest["artifact"]:
        raise PreparationError("trial_verified_download_required")
    connection, checkpoint = open_index(directory / "english.sqlite", manifest["artifact"]["sha256"])
    try:
        if not checkpoint["complete"]:
            with gzip.open(target, "rb") as source:
                checkpoint = index_stream(connection, checkpoint, source, limit)
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        atomic_json(directory / "index.json", checkpoint)
        print(json.dumps({"phase": "indexed" if checkpoint["complete"] else "index_paused", **checkpoint}), flush=True)
    finally:
        connection.close()


def summarize(records):
    senses = [sense for record in records for sense in record.get("senses", [])]
    return {"entries": len(records), "meanings": len(senses),
            "sounds": sum(len(record.get("sounds", [])) for record in records),
            "origins": sum(bool(record.get("etymology_text")) for record in records),
            "rawGlosses": sum(bool(sense.get("raw_glosses")) for sense in senses),
            "altOfMeanings": sum(bool(sense.get("alt_of")) for sense in senses),
            "entryFields": sorted({key for record in records for key in record}),
            "senseFields": sorted({key for sense in senses for key in sense})}


def report(directory, root):
    manifest = read_json(directory / "download.json")
    with sqlite3.connect(f"file:{directory / 'english.sqlite'}?mode=ro", uri=True) as connection:
        checkpoint = json.loads(connection.execute("SELECT value FROM progress WHERE id=1").fetchone()[0])
        counts = dict(connection.execute("SELECT kind,count(*) FROM records GROUP BY kind"))
        distinct = connection.execute("SELECT count(DISTINCT word) FROM records WHERE kind='english'").fetchone()[0]
        samples = []
        local = read_json(root / "extractions/d8d3b078bf4c41478d5e9780f832f71e/public-source-samples.json")
        for word in SAMPLES:
            rows = connection.execute("SELECT ordinal,sha256,raw_json FROM records WHERE word=? AND kind='english' ORDER BY ordinal", (word,)).fetchall()
            records = [json.loads(row[2]) for row in rows]
            own = next(item for item in local if item["word"] == word)
            samples.append({"word": word, "publisher": summarize(records), "local": summarize(own["records"]),
                            "locators": [{"ordinal": row[0], "sha256": row[1]} for row in rows],
                            "publisherRecords": records,
                            "localPageId": own["pageId"], "localRevisionId": own["revisionId"]})
    result = {"status": "trial_indexed_needs_evidence_review" if checkpoint["complete"] else "trial_incomplete",
              "modelCalls": 0, "artifact": manifest["artifact"], "published": manifest.get("published"),
              "downloadSeconds": manifest["elapsedSeconds"], "index": checkpoint, "storedCounts": counts,
              "distinctEnglishWords": distinct, "samples": samples,
              "fileSizes": {path.name: path.stat().st_size for path in directory.iterdir() if path.is_file()}}
    atomic_json(directory / "comparison.json", result)
    print(json.dumps({key: value for key, value in result.items() if key != "samples"}, ensure_ascii=False), flush=True)
    print(json.dumps([{ "word": sample["word"], "publisher": sample["publisher"], "local": sample["local"]}
                      for sample in samples], ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("fetch", "index", "report"))
    parser.add_argument("--directory", type=Path, default=DEFAULT_ROOT / "trials/kaikki-20261006")
    parser.add_argument("--limit", type=int, help="Commit at most this many source records in this indexing session")
    args = parser.parse_args()
    directory = outside_checkout(args.directory)
    directory.mkdir(parents=True, exist_ok=True)
    if args.limit is not None and args.limit < 1:
        raise PreparationError("trial_limit_must_be_positive")
    with source_lock(directory):
        if args.operation == "fetch":
            fetch(directory)
        elif args.operation == "index":
            index(directory, args.limit)
        else:
            report(directory, DEFAULT_ROOT)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(130))
    try:
        main()
    except (KeyboardInterrupt, SystemExit):
        raise
    except Exception as error:
        print(str(error) if isinstance(error, PreparationError) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
