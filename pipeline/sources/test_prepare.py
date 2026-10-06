import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from prepare import (CHECKOUT, PreparationError, download, file_identity,
                     outside_checkout, recover, source_lock, verify_download)


class Response(io.BytesIO):
    def __init__(self, data, status=200, headers=None):
        super().__init__(data)
        self.status = status
        self.headers = headers or {}


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.data = b"a harmless public source fixture\n"
        self.artifact = {"filename": "fixture.gz", "url": "https://example.invalid/fixture.gz",
                         "bytes": len(self.data),
                         "checksums": {"sha1": hashlib.sha1(self.data).hexdigest()}}

    def test_resume_requires_matching_range_and_final_identity(self):
        (self.root / "fixture.gz.part").write_bytes(self.data[:10])
        response = Response(self.data[10:], 206, {"Content-Range": f"bytes 10-{len(self.data)-1}/{len(self.data)}"})
        with patch("urllib.request.urlopen", return_value=response) as request:
            result = download(self.artifact, self.root)
        self.assertEqual(request.call_args.args[0].headers["Range"], "bytes=10-")
        self.assertEqual(result["sha256"], hashlib.sha256(self.data).hexdigest())
        self.assertFalse((self.root / "fixture.gz.part").exists())

    def test_ignored_range_restarts_instead_of_appending(self):
        (self.root / "fixture.gz.part").write_bytes(self.data[:10])
        with patch("urllib.request.urlopen", return_value=Response(self.data)):
            download(self.artifact, self.root)
        self.assertEqual((self.root / "fixture.gz").read_bytes(), self.data)

    def test_wrong_range_and_corruption_never_publish(self):
        (self.root / "fixture.gz.part").write_bytes(self.data[:10])
        with patch("urllib.request.urlopen", return_value=Response(self.data[10:], 206)):
            with self.assertRaisesRegex(PreparationError, "invalid_download_range"):
                download(self.artifact, self.root)
        self.assertFalse((self.root / "fixture.gz").exists())
        with patch("urllib.request.urlopen", return_value=Response(b"x" * len(self.data))):
            with self.assertRaisesRegex(PreparationError, "artifact_checksum_mismatch"):
                download(self.artifact, self.root)
        self.assertFalse((self.root / "fixture.gz").exists())

    def test_repeat_verifies_bytes_without_network(self):
        target = self.root / "fixture.gz"
        target.write_bytes(self.data)
        with patch("urllib.request.urlopen", side_effect=AssertionError("network should not run")):
            download(self.artifact, self.root)
            target.write_bytes(b"changed")
            with self.assertRaisesRegex(PreparationError, "artifact_checksum_mismatch"):
                download(self.artifact, self.root)

    def test_live_owner_blocks_recovery_and_concurrent_preparation(self):
        with source_lock(self.root):
            with self.assertRaisesRegex(PreparationError, "owner_running"):
                recover(self.root)
            with self.assertRaisesRegex(PreparationError, "busy"):
                with source_lock(self.root):
                    self.fail("concurrent acquisition entered")
        self.assertFalse((self.root / "preparation.lock").exists())

    def test_checkout_and_symlink_into_checkout_are_rejected(self):
        with self.assertRaisesRegex(PreparationError, "in_checkout"):
            outside_checkout(CHECKOUT / "untracked-sources")
        (self.root / "linked").symlink_to(CHECKOUT, target_is_directory=True)
        with self.assertRaisesRegex(PreparationError, "in_checkout"):
            outside_checkout(self.root / "linked/sources")


if __name__ == "__main__":
    unittest.main()
