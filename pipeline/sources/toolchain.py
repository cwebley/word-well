"""Build, hash-lock and verify the source-only Python toolchain outside Git."""

import json
from pathlib import Path
import platform
import subprocess
import sys
import urllib.request
import zipfile

from prepare import (CHECKOUT, PreparationError, USER_AGENT, atomic_json,
                     file_identity, identity, read_json)

REQUIREMENTS = CHECKOUT / "config/source-python-requirements.txt"
BROWN_REVISION = "18fcb5421e3d590673282ee5c1624facf960b52c"


def run(arguments, log, cwd=None):
    result = subprocess.run([str(arg) for arg in arguments], cwd=cwd,
                            stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise PreparationError("toolchain_command_failed_see_setup_log")


def verify_toolchain(root, manifest):
    directory = root / "toolchain"
    lock = read_json(directory / "lock.json")
    if lock["extractor"] != manifest["extractor"]:
        raise PreparationError("toolchain_pin_mismatch")
    if lock.get("requirementsSha256") != file_identity(REQUIREMENTS)["sha256"]:
        raise PreparationError("toolchain_dependency_lock_mismatch")
    for artifact in lock["artifacts"]:
        if file_identity(directory / artifact["filename"])["sha256"] != artifact["sha256"]:
            raise PreparationError("toolchain_artifact_changed")
    python = directory / "venv/bin/python"
    result = subprocess.run([str(python), "-c",
                             "import importlib.metadata as m,json,platform;"
                             "print(json.dumps({'python':platform.python_version(),"
                             "'packages':dict(sorted((d.metadata['Name'].lower(),d.version) "
                             "for d in m.distributions()))}))"],
                            capture_output=True, text=True, check=True)
    actual = json.loads(result.stdout)
    if actual != lock["installed"] or platform.machine() != lock["machine"]:
        raise PreparationError("toolchain_environment_changed")
    return python, lock


def setup(root, manifest):
    directory = root / "toolchain"
    directory.mkdir(exist_ok=True)
    if platform.machine() != "arm64" or sys.version_info[:2] != (3, 14) or sys.platform != "darwin":
        raise PreparationError("dependency_artifacts_require_python314_macos_arm64")
    if (directory / "lock.json").exists():
        verify_toolchain(root, manifest)
        print("toolchain_verified", flush=True)
        return
    wheels = directory / "wheels"
    wheels.mkdir(exist_ok=True)
    sources = directory / "source"
    sources.mkdir(exist_ok=True)
    python = directory / "venv/bin/python"
    with (directory / "setup.log").open("a", encoding="utf-8") as log:
        if not python.exists():
            run([sys.executable, "-m", "venv", directory / "venv"], log)
        run([python, "-m", "pip", "download", "--only-binary=:all:", "--dest", wheels,
             "--no-deps", "--require-hashes", "-r", REQUIREMENTS], log)
        # Bootstrap tools themselves are retained and hashed with the runtime wheels.
        run([python, "-m", "pip", "install", "--no-index", "--find-links", wheels,
             "setuptools", "wheel"], log)
        for name in ("wikitextprocessor", "wiktextract"):
            checkout = sources / name
            revision = manifest["extractor"][name]
            if not checkout.exists():
                checkout.mkdir()
                run(["git", "init", checkout], log)
                run(["git", "remote", "add", "origin", f"https://github.com/tatuylonen/{name}.git"], log, checkout)
            run(["git", "fetch", "--depth", "1", "origin", revision], log, checkout)
            run(["git", "checkout", "--detach", revision], log, checkout)
            if name == "wikitextprocessor":
                run(["git", "submodule", "update", "--init", "--recursive", "--depth", "1"], log, checkout)
                # Verify all gitlinks if upstream's directory name changes.
                links = subprocess.check_output(["git", "ls-tree", "-r", "HEAD"], cwd=checkout, text=True)
                if manifest["extractor"]["scribunto"] not in links:
                    raise PreparationError("scribunto_pin_mismatch")
            existing = list(wheels.glob(name + "-*.whl"))
            build_record = directory / (name + "-build.json")
            provenance = read_json(build_record) if build_record.exists() else {}
            reusable = len(existing) == 1 and provenance.get("revision") == revision and \
                provenance.get("sha256") == file_identity(existing[0])["sha256"]
            if not reusable:
                # Never label cached wheel bytes as a new revision after interruption.
                history = directory / "wheel-history"
                history.mkdir(exist_ok=True)
                for old in existing:
                    old.rename(history / (file_identity(old)["sha256"] + "-" + old.name))
                run([python, "-m", "pip", "wheel", "--no-deps", "--no-build-isolation",
                     "--wheel-dir", wheels, checkout], log)
                built = list(wheels.glob(name + "-*.whl"))
                if len(built) != 1:
                    raise PreparationError("extractor_wheel_ambiguous")
                atomic_json(build_record, {"revision": revision, "filename": built[0].name,
                                          "sha256": file_identity(built[0])["sha256"]})
        artifacts = []
        requirements = []
        for wheel in sorted(wheels.glob("*.whl")):
            parts = wheel.name.split("-")
            name, version = parts[0], parts[1]
            actual = file_identity(wheel)
            artifact = {"filename": str(wheel.relative_to(directory)), **actual}
            if name not in ("wiktextract", "wikitextprocessor"):
                url = f"https://pypi.org/pypi/{name}/{version}/json"
                with urllib.request.urlopen(url, timeout=120) as response:
                    published = json.load(response)
                matching = [item for item in published["urls"] if item["filename"] == wheel.name]
                if len(matching) != 1 or matching[0]["digests"]["sha256"] != actual["sha256"]:
                    raise PreparationError("dependency_publisher_checksum_mismatch")
                artifact["url"] = matching[0]["url"]
                artifact["publishedSha256"] = matching[0]["digests"]["sha256"]
            else:
                artifact["gitOrigin"] = f"https://github.com/tatuylonen/{name}.git"
                artifact["gitRevision"] = manifest["extractor"][name]
            artifacts.append(artifact)
            requirements.append(f"{name}=={version} --hash=sha256:{actual['sha256']}")
        (directory / "requirements.txt").write_text("\n".join(requirements) + "\n")
        run([python, "-m", "pip", "install", "--no-index", "--find-links", wheels,
             "--require-hashes", "--no-deps", "--force-reinstall", "-r", directory / "requirements.txt"], log)
        run([python, "-m", "pip", "check"], log)
        # Resolve import-time Brown data before importing Wiktextract. Pin its source bytes.
        nltk = directory / "nltk_data/corpora"
        nltk.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/nltk/nltk_data/{BROWN_REVISION}/packages/corpora/brown.zip"
        target = nltk / "brown.zip"
        if not target.exists():
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": USER_AGENT}), timeout=120) as source:
                temporary = target.with_suffix(".part")
                with temporary.open("wb") as output:
                    while chunk := source.read(1024 * 1024):
                        output.write(chunk)
                temporary.replace(target)
        artifacts.append({"filename": str(target.relative_to(directory)), "url": url, **file_identity(target)})
        if artifacts[-1]["sha256"] != "9b275f9b3b95d7bd66ccfb7cd259f445a13bbe5d1f4107aba09fd3e8364bafa6":
            raise PreparationError("brown_artifact_checksum_mismatch")
        # Retain package provenance and notices without copying public dictionary text into Git.
        notices = directory / "notices"
        notices.mkdir(exist_ok=True)
        for wheel in wheels.glob("*.whl"):
            with zipfile.ZipFile(wheel) as package:
                for name in package.namelist():
                    if any(term in Path(name).name.lower() for term in ("license", "notice", "copying")):
                        data = package.read(name)
                        (notices / (wheel.name + "-" + identity(name)[:12] + ".txt")).write_bytes(data)
        result = subprocess.check_output([python, "-c",
            "import importlib.metadata as m,json,platform;"
            "print(json.dumps({'python':platform.python_version(),"
            "'packages':dict(sorted((d.metadata['Name'].lower(),d.version) for d in m.distributions()))}))"], text=True)
        lock = {"schema": "wordwell-source-toolchain-v1", "extractor": manifest["extractor"],
                "requirementsSha256": file_identity(REQUIREMENTS)["sha256"],
                "machine": platform.machine(), "platform": platform.platform(),
                "installed": json.loads(result), "artifacts": artifacts}
        atomic_json(directory / "lock.json", lock)
        verify_toolchain(root, manifest)
    print(json.dumps({"toolchain": "verified", "identity": identity(lock),
                      "python": lock["installed"]["python"], "artifacts": len(artifacts)}), flush=True)
