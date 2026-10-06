"""Pinned public-source acquisition. Payloads stay outside the checkout.

The owner's #21 amendment permits unencrypted public source preparation.
This module never loads evaluation datasets, database credentials or model code.
"""

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

CHECKOUT = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = Path.home() / "Library/Application Support/WordWell/sources"
USER_AGENT = "WordWell-source-preparation/1 (https://github.com/cwebley/word-well/issues/21)"


class PreparationError(Exception):
    pass


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, sort_keys=True, indent=2)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def identity(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=False).encode()).hexdigest()


def file_identity(path):
    hashes = {name: hashlib.new(name) for name in ("sha1", "sha256")}
    size = 0
    with path.open("rb") as source:
        while chunk := source.read(4 * 1024 * 1024):
            size += len(chunk)
            for digest in hashes.values():
                digest.update(chunk)
    return {"bytes": size, **{name: digest.hexdigest() for name, digest in hashes.items()}}


def verify_download(path, artifact):
    actual = file_identity(path)
    if actual["bytes"] != artifact["bytes"] or any(
        actual[name] != digest for name, digest in artifact["checksums"].items()
    ):
        raise PreparationError("artifact_checksum_mismatch")
    return actual


def outside_checkout(path):
    actual = path.expanduser().resolve()
    if actual == CHECKOUT or CHECKOUT in actual.parents:
        raise PreparationError("source_directory_in_checkout")
    return actual


@contextlib.contextmanager
def source_lock(root):
    path = root / "preparation.lock"
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise PreparationError("source_preparation_busy_use_status_or_recover") from None
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump({"pid": os.getpid(), "startedAt": time.time()}, output)
            output.flush()
            os.fsync(output.fileno())
        yield
    finally:
        path.unlink()


def recover(root):
    path = root / "preparation.lock"
    if not path.exists():
        return
    ownership = read_json(path)
    pid = ownership["pid"]
    if not isinstance(pid, int) or pid < 1:
        raise PreparationError("invalid_lock")
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        if ownership.get("childPid"):
            try:
                os.killpg(ownership["childPid"], 0)
            except ProcessLookupError:
                pass
            else:
                raise PreparationError("source_extraction_process_group_running") from None
        path.unlink()
    else:
        raise PreparationError("source_preparation_owner_running")


def download(artifact, directory):
    """Resume by byte offset, but accept only a full checksum-verified artifact."""
    target = directory / artifact["filename"]
    if target.exists():
        return verify_download(target, artifact)
    partial = target.with_name(target.name + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > artifact["bytes"]:
        raise PreparationError("oversized_partial_download")
    if offset != artifact["bytes"]:
        headers = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = urllib.request.Request(artifact["url"], headers=headers)
        try:
            response = urllib.request.urlopen(request, timeout=120)
        except urllib.error.HTTPError as error:
            raise PreparationError(f"pinned_artifact_http_{error.code}") from None
        with response:
            if offset and response.status == 206:
                expected = f"bytes {offset}-{artifact['bytes'] - 1}/{artifact['bytes']}"
                if response.headers.get("Content-Range") != expected:
                    raise PreparationError("invalid_download_range")
            elif response.status == 200:
                offset = 0  # Server did not honor Range. Restart, never append twice.
            else:
                raise PreparationError("invalid_download_response")
            mode = "ab" if offset else "wb"
            with partial.open(mode) as output:
                while chunk := response.read(4 * 1024 * 1024):
                    output.write(chunk)
                    offset += len(chunk)
                    if offset > artifact["bytes"]:
                        raise PreparationError("oversized_download")
                output.flush()
                os.fsync(output.fileno())
    actual = verify_download(partial, artifact)
    partial.replace(target)
    return actual


def fetch(root, manifest):
    directory = root / "downloads"
    directory.mkdir(exist_ok=True)
    state_path = root / "acquisition.json"
    state = {"schema": "wordwell-source-acquisition-v1", "lockDigest": identity(manifest),
             "status": "loading", "modelCalls": 0, "artifacts": []}
    atomic_json(state_path, state)
    try:
        for artifact in manifest["artifacts"]:
            actual = download(artifact, directory)
            notices = []
            for url in [artifact["noticeUrl"], *artifact.get("additionalNoticeUrls", [])]:
                notices.append(retain_document(root, url))
            publisher = retain_document(root, artifact["checksumOrigin"])
            if artifact["source"] == "wiktionary":
                published = (root / publisher["filename"]).read_text()
                match = re.search(r"^([a-f0-9]{40})\s+" + re.escape(artifact["filename"]) + r"$", published, re.M)
                if not match or match[1] != artifact["checksums"]["sha1"]:
                    raise PreparationError("publisher_checksum_mismatch")
            state["artifacts"].append({**artifact, "local": actual, "notices": notices,
                                        "publisherMetadata": publisher})
            atomic_json(state_path, state)
            print(json.dumps({"source": artifact["source"], "status": "verified",
                              "bytes": actual["bytes"], "sha256": actual["sha256"]}), flush=True)
        state["status"] = "verified"
        atomic_json(state_path, state)
    except Exception:
        state["status"] = "failed"
        atomic_json(state_path, state)
        raise


def retain_document(root, url):
    directory = root / "notices"
    directory.mkdir(exist_ok=True)
    path = directory / (identity(url) + ".txt")
    metadata_path = path.with_suffix(".json")
    if metadata_path.exists():
        metadata = read_json(metadata_path)
        if file_identity(path)["sha256"] != metadata["sha256"]:
            raise PreparationError("source_notice_changed")
        return metadata
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        temporary = path.with_suffix(".part")
        with temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(path)
    metadata = {"url": url, "filename": str(path.relative_to(root)), **file_identity(path)}
    atomic_json(metadata_path, metadata)
    return metadata


def load_manifest(path):
    manifest = read_json(path)
    if manifest.get("schema") != "wordwell-source-lock-v1":
        raise PreparationError("invalid_source_lock")
    for artifact in manifest["artifacts"]:
        if not re.fullmatch(r"[A-Za-z0-9._-]+", artifact["filename"]):
            raise PreparationError("invalid_artifact_filename")
        if not artifact["url"].startswith("https://"):
            raise PreparationError("invalid_artifact_origin")
    return manifest


def extraction(root, manifest, workers, snapshot=None):
    from toolchain import verify_toolchain
    python, toolchain = verify_toolchain(root, manifest)
    acquisition = read_json(root / "acquisition.json")
    if acquisition["status"] != "verified" or acquisition["lockDigest"] != identity(manifest):
        raise PreparationError("sources_not_verified_for_selected_lock")
    for artifact in manifest["artifacts"]:
        verify_download(root / "downloads" / artifact["filename"], artifact)
    code = adapter_code()
    inputs = {"sourceLock": manifest, "toolchainDigest": identity(toolchain), "adapterCode": code,
              "artifacts": {a["source"]: a["local"]["sha256"] for a in acquisition["artifacts"]},
              "workers": workers}
    attempts = root / "extractions"
    attempts.mkdir(exist_ok=True)
    if snapshot:
        if not re.fullmatch(r"[a-f0-9]{32}", snapshot):
            raise PreparationError("invalid_snapshot_id")
        directory = attempts / snapshot
        state = read_json(directory / "state.json")
        if identity(state["inputs"]) != state["inputDigest"] or any(
            state["inputs"].get(name) != value for name, value in inputs.items() if name != "adapterCode"
        ) or any(state["inputs"]["adapterCode"].get(name) != digest for name, digest in code.items()):
            raise PreparationError("extraction_inputs_changed_start_new_snapshot")
        if state["status"] == "ready":
            raise PreparationError("ready_snapshot_is_immutable_use_verify")
    else:
        snapshot = uuid.uuid4().hex
        directory = attempts / snapshot
        directory.mkdir()
        atomic_json(directory / "state.json", {
            "schema": "wordwell-source-extraction-v1", "snapshot": snapshot,
            "inputs": inputs, "inputDigest": identity(inputs), "status": "pending",
            "phase": "ingestion", "modelCalls": 0,
        })
    print(json.dumps({"snapshot": snapshot, "directory": str(directory), "status": "starting"}), flush=True)
    with (directory / "extraction.log").open("a") as log:
        child = subprocess.Popen([str(python), str(Path(__file__).with_name("extract.py")),
                                  str(root), str(directory), "--workers", str(workers)],
                                 stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        ownership = read_json(root / "preparation.lock")
        ownership["childPid"] = child.pid
        atomic_json(root / "preparation.lock", ownership)
        try:
            returncode = child.wait()
        except BaseException:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            raise
    print(json.dumps({"snapshot": snapshot, "status": read_json(directory / "state.json")["status"]}), flush=True)
    if returncode:
        raise PreparationError("extraction_failed_see_source_log")


def adapter_code():
    # Transformation identity excludes read-only verification and setup code.
    # Those can improve acceptance checks without changing extracted source bytes.
    directory = Path(__file__).parent
    return {name: file_identity(directory / name)["sha256"] for name in ("extract.py", "inventories.py")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["fetch", "setup", "extract", "verify", "status", "recover"])
    parser.add_argument("--directory", type=Path,
                        default=Path(os.environ.get("WORDWELL_SOURCE_DIR", DEFAULT_ROOT)))
    parser.add_argument("--manifest", type=Path, default=CHECKOUT / "config/sources.lock.json")
    parser.add_argument("--workers", type=int, choices=range(1, 15), default=4)
    parser.add_argument("--snapshot", help="Explicit existing extraction to resume")
    args = parser.parse_args()
    root = outside_checkout(args.directory)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = load_manifest(args.manifest)
    if args.operation == "status":
        path = root / "acquisition.json"
        state = read_json(path) if path.exists() else {"status": "not_started"}
        extractions = []
        for path in sorted((root / "extractions").glob("*/state.json")):
            saved = read_json(path)
            directory = path.parent
            extractions.append({"snapshot": saved["snapshot"], "status": saved["status"], "phase": saved["phase"],
                                "progress": {name: read_json(directory / name) for name in
                                             ("ingestion-progress.json", "thesaurus-checkpoint.json", "dictionary-checkpoint.json", "resources.json")
                                             if (directory / name).exists()}})
        print(json.dumps({"directory": str(root), "acquisition": state,
                          "locked": (root / "preparation.lock").exists(), "extractions": extractions}))
    elif args.operation == "recover":
        recover(root)
        print("stopped_lock_recovered")
    else:
        with source_lock(root):
            if args.operation == "fetch":
                fetch(root, manifest)
            elif args.operation == "setup":
                from toolchain import setup
                setup(root, manifest)
            elif args.operation == "extract":
                extraction(root, manifest, args.workers, args.snapshot)
            elif args.operation == "verify":
                from verify import verify
                result = verify(root, manifest, args.snapshot)
                # Only aggregate facts reach command output. Complete evidence is local.
                print(json.dumps({key: value for key, value in result.items() if key != "publicExamples"}))
                if result["blockers"]:
                    raise PreparationError("source_coverage_unresolved")


if __name__ == "__main__":
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except KeyboardInterrupt:
        print("source_preparation_interrupted", file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        print(str(error) if isinstance(error, PreparationError) else "source_preparation_failed",
              file=sys.stderr)
        sys.exit(1)
