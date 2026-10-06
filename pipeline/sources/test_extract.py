import bz2
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from extract import Resources, bounded_results, context, ingest, parse_batch, process_pages


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        (self.directory / "network").mkdir()

    def fixture(self, repeated_title=False):
        pages = [
            ("fixture", 0, "==English==\n===Noun===\n# A small test object.\n## A more specific object.\n## A second specific object.\n# Another object.\n==French==\n===Noun===\n# Un objet.\n"),
            ("fixture alias", 0, "#REDIRECT [[fixture]]"),
            ("Template:fixture", 10, "<noinclude>not transcluded</noinclude>retained resource"),
            ("Module:fixture", 828, "return {}"),
        ]
        if repeated_title:
            pages.append(("fixture", 0, "==English==\n===Noun===\n# A second page with the same title.\n"))
        xml = '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/">'
        for order, (title, namespace, text) in enumerate(pages, 1):
            model = "Scribunto" if namespace == 828 else "wikitext"
            redirect = '<redirect title="fixture"/>' if order == 2 else ""
            xml += f"<page><title>{title}</title><ns>{namespace}</ns><id>{order}</id>{redirect}<revision><id>{100+order}</id><timestamp>2026-09-01T00:00:00Z</timestamp><model>{model}</model><text><![CDATA[{text}]]></text></revision></page>"
        xml += "</mediawiki>"
        dump = self.directory / "fixture.xml.bz2"
        dump.write_bytes(bz2.compress(xml.encode()))
        return dump

    def test_ingestion_keeps_revision_identity_and_original_template_text(self):
        wxr = context(self.directory / "resources.sqlite")
        try:
            with patch("wikitextprocessor.interwiki.init_interwiki_map"):
                result = ingest(wxr, self.fixture(), self.directory)
            self.assertEqual(result["dump_pages"], 4)
            self.assertEqual(result["missing_ingested_resources"], 0)
            pages = sqlite3.connect(self.directory / "pages.sqlite")
            try:
                row = pages.execute("SELECT page_id,revision_id,raw_wikitext FROM pages WHERE ordinal=3").fetchone()
            finally:
                pages.close()
            self.assertEqual(row[:2], ("3", "103"))
            self.assertIn("not transcluded", row[2])
            self.assertNotIn("not transcluded", wxr.wtp.get_page_body("Template:fixture", 10))
            self.assertFalse((self.directory / "resources_backup.sqlite").exists())
        finally:
            wxr.remove_unpicklable_objects()

    def test_repeated_titles_preserve_distinct_dump_page_identities(self):
        wxr = context(self.directory / "resources.sqlite")
        try:
            with patch("wikitextprocessor.interwiki.init_interwiki_map"):
                result = ingest(wxr, self.fixture(repeated_title=True), self.directory)
            self.assertEqual(result["dump_pages"], 5)
            pages = sqlite3.connect(self.directory / "pages.sqlite")
            try:
                rows = pages.execute("SELECT page_id,revision_id,raw_wikitext FROM pages WHERE title='fixture' ORDER BY ordinal").fetchall()
            finally:
                pages.close()
            self.assertEqual([row[:2] for row in rows], [("1", "101"), ("5", "105")])
            self.assertIn("A small test object.", rows[0][2])
            self.assertIn("A second page", rows[1][2])
            self.assertEqual(result["repeated_resource_titles"], 1)
            process_pages(wxr, self.directory, 1, False)
            entries = [json.loads(line) for line in (self.directory / "dictionary.jsonl").read_text().splitlines()]
            matching = [row for row in entries if row["record"].get("word") == "fixture"]
            self.assertEqual([row["page"]["page_id"] for row in matching], ["1", "5"])
            self.assertIn("A small test object.", matching[0]["record"]["senses"][0]["glosses"])
            self.assertEqual(matching[1]["record"]["senses"][0]["glosses"], ["A second page with the same title."])
        finally:
            wxr.remove_unpicklable_objects()

    def test_bounded_worker_output_preserves_gloss_paths_language_and_rerun(self):
        wxr = context(self.directory / "resources.sqlite")
        try:
            with patch("wikitextprocessor.interwiki.init_interwiki_map"):
                ingest(wxr, self.fixture(), self.directory)
            result = process_pages(wxr, self.directory, 1, False)
            self.assertTrue(result["complete"])
            self.assertEqual(result["counts"]["failedPages"], 0)
            output = self.directory / "dictionary.jsonl"
            before = output.read_bytes()
            rows = [json.loads(line) for line in before.splitlines()]
            entry = next(row for row in rows if row["record"].get("lang_code") == "en")
            self.assertEqual(entry["page"]["revision_id"], "101")
            self.assertEqual(entry["record"]["senses"][0]["glosses"],
                             ["A small test object.", "A more specific object."])
            self.assertFalse(any(row["record"].get("lang_code") == "fr" for row in rows))
            # Nonempty output is insufficient: use its explicit complete checkpoint.
            process_pages(wxr, self.directory, 1, False)
            self.assertEqual(output.read_bytes(), before)
            # Interrupted output tails are truncated at the last durable batch.
            checkpoint_path = self.directory / "dictionary-checkpoint.json"
            checkpoint = json.loads(checkpoint_path.read_text())
            checkpoint["complete"] = False
            checkpoint_path.write_text(json.dumps(checkpoint))
            with output.open("ab") as tail:
                tail.write(b"uncommitted interrupted batch\n")
            process_pages(wxr, self.directory, 1, False)
            self.assertEqual(output.read_bytes(), before)
            # Same-length corruption of committed evidence is never accepted.
            output.write_bytes(b"X" + before[1:])
            from prepare import PreparationError
            with self.assertRaisesRegex(PreparationError, "checkpoint_output_changed"):
                process_pages(wxr, self.directory, 1, False)
        finally:
            wxr.remove_unpicklable_objects()

    def test_page_exception_is_retained_without_a_success_record(self):
        wxr = context(self.directory / "resources.sqlite")
        try:
            metadata = {"title": "fixture", "redirect": None}
            with patch("extract.WORKER", wxr), patch("wiktextract.page.parse_page", side_effect=RuntimeError("harmless source failure")):
                result = parse_batch([(metadata, "==English==")], False)
            self.assertEqual(result[0][1], [])
            self.assertIn("harmless source failure", result[0][3])
        finally:
            wxr.remove_unpicklable_objects()

    def test_large_input_does_not_submit_unbounded_pending_page_bodies(self):
        class Future:
            def __init__(self, executor, batch):
                self.executor, self.batch = executor, batch
            def result(self):
                self.executor.pending -= 1
                return self.batch
        class Executor:
            pending = 0
            peak = 0
            def submit(self, _function, batch, _thesaurus):
                self.pending += 1
                self.peak = max(self.pending, self.peak)
                return Future(self, batch)
        executor = Executor()
        observed = list(bounded_results(executor, range(1000), False, 2))
        self.assertEqual(observed, list(range(1000)))
        self.assertLessEqual(executor.peak, 8)

    def test_resume_retains_previous_resource_peaks_and_elapsed_time(self):
        saved = {"elapsedSeconds": 120, "peakProcessTreeRssBytes": 10**12,
                 "peakAllocatedSourceDiskBytes": 10**12, "samples": 7}
        path = self.directory / "resources.json"
        path.write_text(json.dumps(saved))
        with Resources(self.directory, self.directory):
            pass
        resumed = json.loads(path.read_text())
        self.assertGreaterEqual(resumed["elapsedSeconds"], 120)
        self.assertEqual(resumed["peakProcessTreeRssBytes"], saved["peakProcessTreeRssBytes"])
        self.assertEqual(resumed["peakAllocatedSourceDiskBytes"], saved["peakAllocatedSourceDiskBytes"])
        self.assertGreater(resumed["samples"], saved["samples"])


if __name__ == "__main__":
    unittest.main()
