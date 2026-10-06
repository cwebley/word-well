"""Read-only artifact/coverage verification. Partial extraction cannot pass."""

from collections import Counter
import json
from pathlib import Path
import re
import sqlite3

from prepare import PreparationError, adapter_code, file_identity, identity, read_json, verify_download
from toolchain import verify_toolchain


def verify(root, manifest, snapshot):
    if not snapshot or not re.fullmatch(r"[a-f0-9]{32}", snapshot):
        raise PreparationError("verify_requires_explicit_snapshot")
    _, toolchain = verify_toolchain(root, manifest)
    acquisition = read_json(root / "acquisition.json")
    if acquisition["status"] != "verified" or acquisition["lockDigest"] != identity(manifest):
        raise PreparationError("source_acquisition_not_verified")
    for artifact in manifest["artifacts"]:
        verify_download(root / "downloads" / artifact["filename"], artifact)
    directory = root / "extractions" / snapshot
    state = read_json(directory / "state.json")
    if state["inputs"]["sourceLock"] != manifest or identity(state["inputs"]) != state["inputDigest"]:
        raise PreparationError("snapshot_source_contract_mismatch")
    if any(state["inputs"]["adapterCode"].get(name) != digest for name, digest in adapter_code().items()):
        raise PreparationError("snapshot_adapter_code_mismatch")
    if state["inputs"]["toolchainDigest"] != identity(toolchain):
        raise PreparationError("snapshot_toolchain_mismatch")
    if state["status"] not in {"extracted_needs_coverage_review", "ready"}:
        raise PreparationError("extraction_not_complete")
    required = {"pages.sqlite", "resources.sqlite", "resources_thesaurus.sqlite",
                "frequency.jsonl", "frequency-coverage.json", "oewn-coverage.json"}
    if not required.issubset(state.get("artifacts", {})):
        raise PreparationError("required_source_artifact_identity_missing")
    for name, expected in state["artifacts"].items():
        if Path(name).name != name or file_identity(directory / name) != expected:
            raise PreparationError("source_artifact_changed")
    for name, expected in state["networkArtifacts"].items():
        if Path(name).name != name or file_identity(directory / "network" / name) != expected:
            raise PreparationError("source_network_artifact_changed")
    verify_initial_artifacts(directory)
    for artifact in acquisition["artifacts"]:
        for document in [*artifact["notices"], artifact["publisherMetadata"]]:
            if file_identity(root / document["filename"])["sha256"] != document["sha256"]:
                raise PreparationError("source_notice_changed")
    counts = {}
    blockers = []
    ingestion = read_json(directory / "ingestion.json")
    if ingestion["counts"].get("repeated_resource_titles", 0) or ingestion["counts"].get("repeated_page_ids", 0):
        blockers.append("source_identity_conflict_review")
    outputs = []
    for phase in ("thesaurus", "dictionary"):
        checkpoint = read_json(directory / (phase + "-checkpoint.json"))
        if not checkpoint["complete"]:
            raise PreparationError("extraction_phase_incomplete")
        for suffix, checksum in [(".jsonl", "outputSha256"), ("-diagnostics.jsonl", "diagnosticSha256")]:
            path = directory / (phase + suffix)
            actual = file_identity(path)
            if actual["sha256"] != checkpoint[checksum]:
                raise PreparationError("extracted_artifact_changed")
            outputs.append({"filename": path.name, **actual})
        counts[phase] = checkpoint["counts"]
        if checkpoint["counts"]["failedPages"]:
            blockers.append(phase + "_page_failures")
        if checkpoint["counts"]["unresolvedDiagnostics"]:
            blockers.append(phase + "_unclassified_diagnostics")
    # Count every emitted record again rather than trusting a successful exit.
    observed = Counter()
    examples = {}
    safe_words = {"emulate", "tee", "colour", "color", "corgis", "mix"}
    with (directory / "dictionary.jsonl").open() as source:
        for line in source:
            row = json.loads(line)
            record = row["record"]
            observed["records"] += 1
            if record.get("pos") == "hard-redirect":
                observed["redirects"] += 1
                continue
            if record.get("lang_code") != "en" or not row["page"]["revision_id"]:
                raise PreparationError("invalid_dictionary_language_or_identity")
            observed["english_entries"] += 1
            observed["meanings"] += len(record.get("senses", []))
            for field in ("sounds", "etymology_text", "forms", "derived", "related"):
                observed["entries_with_" + field] += int(bool(record.get(field)))
            for meaning in record.get("senses", []):
                for field in ("tags", "topics", "raw_glosses", "form_of", "alt_of", "examples"):
                    observed["meanings_with_" + field] += int(bool(meaning.get(field)))
            if record.get("word") in safe_words:
                examples.setdefault(record["word"], []).append(row)
    if observed["records"] != counts["dictionary"]["records"] or not observed["english_entries"]:
        raise PreparationError("dictionary_record_count_mismatch")
    companion = sqlite3.connect(f"file:{directory / 'pages.sqlite'}?mode=ro", uri=True)
    try:
        # The pinned English edition extracts main and reconstruction namespaces.
        def selected_pages(namespaces, thesaurus):
            query = f"SELECT count(*) FROM pages WHERE stored=1 AND model='wikitext' AND namespace IN ({','.join('?' for _ in namespaces)})"
            if thesaurus:
                query += " AND redirect IS NULL"
            return companion.execute(query, namespaces).fetchone()[0]
        expected_dictionary = selected_pages(state["selection"]["dictionaryNamespaces"], False)
        expected_thesaurus = selected_pages(state["selection"]["thesaurusNamespaces"], True)
    finally:
        companion.close()
    if counts["dictionary"]["pages"] != expected_dictionary or counts["thesaurus"]["pages"] != expected_thesaurus:
        raise PreparationError("page_coverage_mismatch")
    # Explicit preference/source-origin mapping still requires actual dump evidence.
    mappings = directory / "field-mappings.json"
    if not mappings.exists() or read_json(mappings).get("status") != "verified":
        blockers.append("required_field_mapping_review")
    resource_path = directory / "resources.json"
    if not resource_path.exists() or read_json(resource_path).get("samples", 0) == 0:
        blockers.append("resource_measurement_missing")
    return {"snapshot": snapshot, "status": "blocked" if blockers else "verified",
            "blockers": blockers, "pageCounts": counts, "observed": dict(observed),
            "artifacts": outputs, "publicExamples": examples, "modelCalls": 0}


def verify_initial_artifacts(directory):
    # Compare with phase-completion identities, not merely hashes recorded again
    # at finalization. Corruption during an interruption cannot become new truth.
    frequency = read_json(directory / "frequency-coverage.json")
    if frequency["status"] != "verified" or frequency["version"] != "3.1.1" or \
            frequency["language"] != "en" or frequency["wordlist"] != "large":
        raise PreparationError("frequency_manifest_invalid")
    for artifact in (frequency["output"], frequency["dataArtifact"]):
        if Path(artifact["filename"]).name != artifact["filename"]:
            raise PreparationError("invalid_frequency_artifact_path")
        actual = file_identity(directory / artifact["filename"])
        if any(actual[key] != artifact[key] for key in ("bytes", "sha1", "sha256")):
            raise PreparationError("frequency_phase_artifact_changed")
    ingestion = read_json(directory / "ingestion.json")
    if ingestion["status"] != "complete" or file_identity(directory / "pages.sqlite") != ingestion["companion"]:
        raise PreparationError("ingestion_phase_artifact_changed")
