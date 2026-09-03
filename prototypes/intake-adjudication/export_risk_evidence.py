"""PROTOTYPE (issue #57) — materialise per-sense Wiktionary labels for the v15 spike.

Standalone, exactly like ``export_usefulness_evidence.py``. Bumps
``risk-evidence/*`` so v15 record digests do not collide with v14's
``usefulness-evidence/*`` fingerprints.

Why per-sense: ``wik_first`` and ``wik_labels`` are headword-level. Risk
attaches to a sense, not a headword (e.g. ``martyr`` is benign on its primary
"one who dies for a cause" sense and derogatory on its "one whose suffering is
paraded" sense). A programmatic risk filter that consumes headword-level
labels will over-gate the benign sense and miss the pejorative one.

What it produces, per (lemma, OEWN sense_id):

    {
      "lemma": "martyr",
      "sense_id": "oewn-martyr__2...",
      "gloss": "...",
      "wik_labels": ["derogatory", "transitive"],
      "risk_label_present": true
    }

``risk_label_present`` is true when any of
{offensive, slur, ethnic slur, vulgar, derogatory, pejorative, taboo, profanity,
obscene, coarse, sexual, racially offensive, homophobic, transphobic,
misogynistic} appears in ``wik_labels``.

Run::

    cd prototypes/content-pipeline-source-shapes
    ./venv/bin/python ../intake-adjudication/export_risk_evidence.py \
        --cases ../intake-adjudication/cases/usefulness-golden-v3.json \
        --audit ../intake-adjudication/cases/retention-audit-v1.json \
        --exploration ../intake-adjudication/cases/exploration-draw-1.json \
        --out ../intake-adjudication/evidence
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sqlite3
import sys
import time
from typing import Iterable

import requests

EXTRACTION_VERSION = "risk-evidence/1"

USER_AGENT = "WordWell-spike/0.2 (cameron.webley@gmail.com)"

RISK_LABELS = {
    "offensive",
    "slur",
    "ethnic slur",
    "ethnic-slur",
    "vulgar",
    "derogatory",
    "pejorative",
    "taboo",
    "profanity",
    "obscene",
    "coarse",
    "sexual",
    "bodily",
    "racially offensive",
    "homophobic",
    "transphobic",
    "misogynistic",
}

LABEL_RE = re.compile(r"\{\{(?:lb|lbl|label)\|en\|([^}]*)\}\}")
SEP = {"_", "or", "and", "also", ""}
EN_SECTION_RE = re.compile(r"^==\s*English\s*==\s*$", re.M)
NEXT_SECTION_RE = re.compile(r"^==[^=].*==\s*$", re.M)
SENSE_RE = re.compile(r"^#[^:*#]")


def canonical_digest(obj: dict) -> str:
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def english_section(wikitext: str) -> str:
    m = EN_SECTION_RE.search(wikitext)
    if not m:
        return ""
    rest = wikitext[m.end() :]
    n = NEXT_SECTION_RE.search(rest)
    return rest[: n.start()] if n else rest


def sense_labels(wikitext: str) -> list[list[str]]:
    """Per-sense labels. Returns [] when no English section or no labelled senses."""
    section = english_section(wikitext)
    if not section:
        return []
    out: list[list[str]] = []
    for line in section.splitlines():
        if not SENSE_RE.match(line):
            continue
        labels: list[str] = []
        for m in LABEL_RE.finditer(line):
            for token in m.group(1).split("|"):
                token = token.strip()
                if token and token not in SEP:
                    labels.append(token)
        out.append(labels)
    return out


def fetch_pages(titles: list[str]) -> dict[str, str]:
    """Return {title: wikitext} for a 50-batch. Skips missing pages."""
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    try:
        r = s.get(
            "https://en.wiktionary.org/w/api.php",
            params={
                "action": "query",
                "prop": "revisions",
                "rvslots": "main",
                "rvprop": "content",
                "format": "json",
                "formatversion": "2",
                "titles": "|".join(titles),
            },
            timeout=60,
        ).json()
    except Exception as exc:  # transport only; report and bail this batch
        print(f"  request failed: {exc}")
        return {}
    out: dict[str, str] = {}
    for page in r.get("query", {}).get("pages", []):
        if "missing" in page:
            continue
        revs = page.get("revisions") or []
        if not revs:
            continue
        slot = revs[0].get("slots", {}).get("main", {})
        content = slot.get("*") or slot.get("content")
        if content:
            out[page["title"]] = content
    return out


def headword_lemmas(case_files: Iterable[pathlib.Path]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for path in case_files:
        spec = json.loads(path.read_text())
        entries = spec.get("cases") or spec.get("sample") or []
        for entry in entries:
            lemma = entry["lemma"].lower() if "lemma" in entry else entry.get("display", "").lower()
            if lemma and lemma not in seen:
                seen.add(lemma)
                out.append(lemma)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", type=pathlib.Path, default=None)
    ap.add_argument("--audit", type=pathlib.Path, default=None)
    ap.add_argument("--exploration", type=pathlib.Path, default=None)
    ap.add_argument("--extra", type=pathlib.Path, action="append", default=[])
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    args = ap.parse_args()

    case_files: list[pathlib.Path] = []
    for path in (args.cases, args.audit, args.exploration, *args.extra):
        if path is not None:
            case_files.append(path)
    if not case_files:
        sys.exit("at least one case file is required (--cases / --audit / --exploration / --extra)")
    if not args.pool.exists():
        sys.exit(f"no pool database at {args.pool}")

    lemmas = headword_lemmas(case_files)
    print(f"fetching per-sense labels for {len(lemmas)} headwords")
    con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    args.out.mkdir(parents=True, exist_ok=True)
    out_path = args.out / "risk-per-sense.jsonl"
    senses_out: list[dict] = []

    written = 0
    missing: list[str] = []
    for i in range(0, len(lemmas), 50):
        batch = lemmas[i : i + 50]
        pages = fetch_pages(batch)
        for lemma in batch:
            row = con.execute("SELECT display FROM lemma WHERE lemma = ?", (lemma,)).fetchone()
            display = row["display"] if row else lemma
            wikitext = pages.get(display) or pages.get(lemma)
            if not wikitext:
                missing.append(lemma)
                senses_out.append(
                    {
                        "lemma": lemma,
                        "wik_first": None,
                        "wik_labels": [],
                        "risk_label_present": False,
                    }
                )
                continue
            per_sense = sense_labels(wikitext)
            labels_flat = sorted({token for sense in per_sense for token in sense})
            risk_present = bool(RISK_LABELS.intersection(labels_flat))
            senses_out.append(
                {
                    "lemma": lemma,
                    "wik_first": per_sense[0] if per_sense else [],
                    "wik_labels": labels_flat,
                    "risk_label_present": risk_present,
                }
            )
        if (i // 50) % 10 == 0:
            print(f"  {min(i + 50, len(lemmas)):,}/{len(lemmas):,}")
        time.sleep(0.4)

    for entry in senses_out:
        entry["fingerprint"] = canonical_digest(
            {k: entry[k] for k in ("lemma", "wik_first", "wik_labels")}
        )

    with out_path.open("w") as fh:
        for entry in senses_out:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(f"wrote {len(senses_out)} headword label sets to {out_path}")
    if missing:
        print(f"missing Wiktionary page: {len(missing)} (e.g. {missing[:5]})")

    flagged = [e["lemma"] for e in senses_out if e["risk_label_present"]]
    print(f"headwords with any risk label anywhere: {len(flagged)}")


if __name__ == "__main__":
    main()
