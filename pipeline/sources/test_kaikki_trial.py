"""Trial recovery checks using public markers and a local HTTP range server."""

import hashlib
from http.server import BaseHTTPRequestHandler, HTTPServer
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import kaikki_trial as trial
from prepare import PreparationError, atomic_json, read_json


class TrialTests(unittest.TestCase):
    def test_empty_redirect_title_is_retained_and_counted(self):
        line = b'{"title": "", "redirect": "Appendix:Control characters", "pos": "hard-redirect"}\n'
        with tempfile.TemporaryDirectory() as directory:
            connection, checkpoint = trial.open_index(Path(directory) / "index.sqlite", "source-digest")
            trial.index_stream(connection, checkpoint, io.BytesIO(line))
            row = connection.execute("SELECT word,kind,raw_json,sha256 FROM records").fetchone()
            self.assertEqual(row, ("", "redirect", line.decode(), hashlib.sha256(line).hexdigest()))
            self.assertEqual(checkpoint["counts"]["emptyRedirectTitles"], 1)
            self.assertTrue(checkpoint["complete"])
            connection.close()

    def test_index_resume_preserves_records_redirects_and_order(self):
        records = [
            {"word": "dictionary", "lang_code": "en", "pos": "noun", "senses": [{"tags": ["rare"]}]},
            {"word": "foreign-marker", "lang_code": "fr", "pos": "noun"},
            {"title": "redirect-marker", "redirect": "dictionary", "pos": "hard-redirect"},
            {"word": "dictionary", "lang_code": "en", "pos": "verb", "senses": [{}]},
        ]
        content = b"".join((json.dumps(record) + "\n").encode() for record in records)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.sqlite"
            connection, checkpoint = trial.open_index(path, "source-digest")
            trial.index_stream(connection, checkpoint, io.BytesIO(content), limit=2)
            connection.close()
            connection, checkpoint = trial.open_index(path, "source-digest")
            self.assertEqual(checkpoint["ordinal"], 2)
            trial.index_stream(connection, checkpoint, io.BytesIO(content))
            rows = connection.execute("SELECT ordinal,kind,raw_json FROM records ORDER BY ordinal").fetchall()
            self.assertEqual([(row[0], row[1]) for row in rows], [(1, "english"), (3, "redirect"), (4, "english")])
            self.assertEqual(json.loads(rows[0][2]), records[0])
            self.assertEqual(checkpoint["counts"], {"sourceRecords": 4, "englishRecords": 2,
                                                  "englishMeanings": 2, "filteredOtherRecords": 1,
                                                  "neutralRedirects": 1})
            self.assertTrue(checkpoint["complete"])
            trial.index_stream(connection, checkpoint, io.BytesIO(content))
            self.assertEqual(connection.execute("SELECT count(*) FROM records").fetchone()[0], 3)
            connection.close()
            with self.assertRaisesRegex(PreparationError, "input_changed"):
                trial.open_index(path, "different-digest")

    def test_malformed_record_rolls_back_only_uncommitted_batch(self):
        line = b'{"word":"dictionary","lang_code":"en","pos":"noun"}\n'
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.sqlite"
            connection, checkpoint = trial.open_index(path, "source-digest")
            with self.assertRaises(json.JSONDecodeError):
                trial.index_stream(connection, checkpoint, io.BytesIO(line + line + line + b"bad-json\n"), batch_size=2)
            connection.close()
            connection, checkpoint = trial.open_index(path, "source-digest")
            self.assertEqual(checkpoint["ordinal"], 2)
            self.assertEqual(checkpoint["offset"], 2 * len(line))
            self.assertEqual(connection.execute("SELECT count(*) FROM records").fetchone()[0], 2)
            connection.close()

    def test_download_recovery_tail_integrity_and_rolling_identity(self):
        data = b"abcdefghijklmnopqrstuvwxyz"
        requested = []

        class Handler(BaseHTTPRequestHandler):
            etag = '"fixed-v1"'

            def do_HEAD(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("ETag", self.etag)
                self.end_headers()

            def do_GET(self):
                if self.headers.get("If-Match") != self.etag:
                    self.send_error(412)
                    return
                start, end = map(int, self.headers["Range"].removeprefix("bytes=").split("-"))
                requested.append((start, end))
                self.send_response(206)
                self.send_header("ETag", self.etag)
                self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                self.send_header("Content-Length", str(end - start + 1))
                self.end_headers()
                self.wfile.write(data[start:end + 1])

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/fixture"
        try:
            with tempfile.TemporaryDirectory() as directory:
                directory = Path(directory)
                manifest = {"remote": trial.remote_identity(url), "status": "downloading", "elapsedSeconds": 0,
                            "chunks": [{"bytes": 8, "sha256": hashlib.sha256(data[:8]).hexdigest()}]}
                atomic_json(directory / "download.json", manifest)
                partial = directory / "raw-wiktextract-data.jsonl.gz.part"
                partial.write_bytes(data[:8] + b"interrupted-tail")
                Handler.etag = '"changed-v2"'
                with self.assertRaisesRegex(PreparationError, "remote_changed"):
                    trial.fetch(directory, url)
                self.assertEqual(partial.read_bytes(), data[:8] + b"interrupted-tail")
                Handler.etag = '"fixed-v1"'
                with patch.object(trial, "CHUNK", 8):
                    trial.fetch(directory, url)
                self.assertEqual(requested[0], (8, 15))
                target = directory / "raw-wiktextract-data.jsonl.gz"
                self.assertEqual(target.read_bytes(), data)
                saved = read_json(directory / "download.json")
                saved["status"] = "downloading"  # Simulate interruption just after atomic file rename.
                saved.pop("artifact")
                atomic_json(directory / "download.json", saved)
                trial.fetch(directory, url)
                self.assertEqual(read_json(directory / "download.json")["status"], "downloaded")
                before = len(requested)
                trial.fetch(directory, url)
                self.assertEqual(len(requested), before)
                target.write_bytes(b"corruption" + data)
                with self.assertRaisesRegex(PreparationError, "download_changed"):
                    trial.fetch(directory, url)
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_corrupt_committed_prefix_is_rejected_without_truncating(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "partial"
            path.write_bytes(b"changed-tail")
            with self.assertRaisesRegex(PreparationError, "prefix_changed"):
                trial.check_prefix(path, [{"bytes": 4, "sha256": hashlib.sha256(b"good").hexdigest()}])
            self.assertEqual(path.read_bytes(), b"changed-tail")


if __name__ == "__main__":
    unittest.main()
