"""Private experiment files and content identities."""

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True,
                                     allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def file_hash(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def save(path, value, *, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if immutable and path.exists():
        if load(path) != value:
            raise ValueError("Refusing to overwrite an immutable artifact: " + str(path))
        return
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, indent=2, ensure_ascii=True, allow_nan=False)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def word_id(headword):
    return "word-" + digest(headword.casefold())[:20]


def snapshot(root, path):
    """Keep exact source bytes, including the original export's whitespace."""
    source = Path(path)
    identity = file_hash(source)
    target = Path(root) / "inputs" / (identity + source.suffix)
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not target.exists():
        with target.open("xb") as stream:
            os.chmod(target, 0o600)
            stream.write(source.read_bytes())
            stream.flush()
            os.fsync(stream.fileno())
    if file_hash(target) != identity:
        raise ValueError("Input snapshot checksum mismatch")
    return {"name": source.name, "sha256": identity, "artifact": str(target.relative_to(root))}
