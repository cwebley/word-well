from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from prepare import PreparationError, atomic_json, file_identity, identity
from verify import verify, verify_initial_artifacts


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.snapshot = "a" * 32
        self.directory = self.root / "extractions" / self.snapshot
        self.directory.mkdir(parents=True)
        self.manifest = {"mappingVersion": "fixture-v1", "artifacts": []}
        self.toolchain = {"schema": "fixture-toolchain"}
        self.inputs = {"sourceLock": self.manifest, "toolchainDigest": identity(self.toolchain), "adapterCode": {}}
        self.state = {"inputs": self.inputs, "inputDigest": identity(self.inputs),
                      "status": "extracted_needs_coverage_review", "artifacts": {}}
        atomic_json(self.root / "acquisition.json", {"status": "verified", "lockDigest": identity(self.manifest), "artifacts": []})
        for target, value in [("verify.verify_toolchain", ("fixture-python", self.toolchain)),
                              ("verify.adapter_code", {})]:
            mock = patch(target, return_value=value)
            mock.start()
            self.addCleanup(mock.stop)

    def save_state(self):
        atomic_json(self.directory / "state.json", self.state)

    def test_missing_required_frequency_artifact_cannot_verify(self):
        self.save_state()
        with self.assertRaisesRegex(PreparationError, "required_source_artifact_identity_missing"):
            verify(self.root, self.manifest, self.snapshot)

    def test_changed_mapping_selection_cannot_verify_old_snapshot(self):
        current = {**self.manifest, "mappingVersion": "fixture-v2"}
        atomic_json(self.root / "acquisition.json", {"status": "verified", "lockDigest": identity(current), "artifacts": []})
        self.save_state()
        with self.assertRaisesRegex(PreparationError, "snapshot_source_contract_mismatch"):
            verify(self.root, current, self.snapshot)

    def test_corrupted_frequency_payload_is_rejected(self):
        for name in ("pages.sqlite", "resources.sqlite", "resources_thesaurus.sqlite", "frequency.jsonl",
                     "frequency-coverage.json", "oewn-coverage.json"):
            path = self.directory / name
            path.write_bytes(b"harmless verified fixture bytes")
            self.state["artifacts"][name] = file_identity(path)
        (self.directory / "frequency.jsonl").write_bytes(b"changed fixture bytes")
        self.save_state()
        with self.assertRaisesRegex(PreparationError, "source_artifact_changed"):
            verify(self.root, self.manifest, self.snapshot)

    def test_refinalizing_corrupted_frequency_does_not_redefine_phase_identity(self):
        payload = self.directory / "frequency.jsonl"
        data = self.directory / "large_en.msgpack.gz"
        payload.write_bytes(b"original harmless frequency observations")
        data.write_bytes(b"original harmless frequency bins")
        coverage = {"status": "verified", "version": "3.1.1", "language": "en", "wordlist": "large",
                    "output": {"filename": payload.name, **file_identity(payload)},
                    "dataArtifact": {"filename": data.name, **file_identity(data)}}
        atomic_json(self.directory / "frequency-coverage.json", coverage)
        payload.write_bytes(b"corrupted after interrupted extraction")
        # A fresh finalization hash matches the corrupt bytes. The phase hash must not.
        self.state["artifacts"][payload.name] = file_identity(payload)
        with self.assertRaisesRegex(PreparationError, "frequency_phase_artifact_changed"):
            verify_initial_artifacts(self.directory)


if __name__ == "__main__":
    unittest.main()
