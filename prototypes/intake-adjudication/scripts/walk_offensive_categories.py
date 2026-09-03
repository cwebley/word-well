"""PROTOTYPE (issue #57) — walk Wiktionary's offensive-term categories and build
a deterministic category-membership risk gate.

The gate is the user's insight: if Wiktionary has categorised a headword as
offensive, the gate blocks it. No model call, no per-sense label fishing.

This walker is the *enumeration* half. The *application* half lives in
``scripts/apply_category_gate.py`` so the data is fetchable once and
reusable across runs.

Local prototype only. The slur list is never committed. The script writes to
``runs/category-membership.jsonl`` (gitignored) with one record per
{headword, category} pair. No quote text, no rationale, no committed artifact
that reproduces the slur list.

What the walker does:
- Paginates ``Category:English_offensive_terms``, ``...ethnic_slurs``,
  ``...racial_slurs``, ``...vulgarities``, ``...disabled_slang``.
- Captures lemma, primary category, subcategories, subcategory depth.
- Deduplicates and writes one row per lemma with the joined category set.

What it does NOT do:
- Store rationales, definitions, or example sentences.
- Echo the slur text back to the user. The script only prints aggregate
  counts and category intersections.
- Modify any committed file.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sqlite3
import sys
import time
import unicodedata
from typing import Iterable

import requests

USER_AGENT = "WordWell-spike/0.3 (cameron.webley@gmail.com)"

CATEGORIES = [
    ("English_offensive_terms", "offensive_general"),
    ("English_ethnic_slurs", "ethnic_slur"),
    ("English_racial_slurs", "racial_slur"),
    ("English_vulgarities", "vulgar"),
    ("English_disabled_slang", "disabled_slang"),
]

API = "https://en.wiktionary.org/w/api.php"


def category_members(cat: str, session: requests.Session) -> Iterable[str]:
    """Yield every member title in a category, paginating on ``cmcontinue``."""
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": f"Category:{cat}",
        "cmtype": "page",
        "cmlimit": "500",
        "format": "json",
        "formatversion": "2",
    }
    while params:
        resp = session.get(API, params=params, timeout=60)
        if resp.status_code == 429:
            time.sleep(5)
            continue
        resp.raise_for_status()
        data = resp.json()
        for entry in data.get("query", {}).get("categorymembers", []):
            ns = entry.get("ns", 0)
            title = entry.get("title", "")
            if ns != 0:
                continue
            yield title
        cont = data.get("continue", {}).get("cmcontinue")
        if not cont:
            return
        params["cmcontinue"] = cont


def is_lemma(title: str) -> bool:
    """Reasonable lemma heuristic for Wiktionary titles.

    Drops multi-word phrases, capitalized names, and pages containing
    non-letter characters in their title (these are usually idioms, phrases
    or compound entries rather than single-word lemmas).
    """
    if not title:
        return False
    if " " in title:
        return False
    if title[0].isupper():
        return False
    norm = unicodedata.normalize("NFKD", title)
    if any(not (ch.isascii() and ch.isalpha() or ch in "-'.") for ch in norm):
        return False
    if not re.fullmatch(r"[a-zA-Z][a-zA-Z\-'.]*", title):
        return False
    return True


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--out", default=pathlib.Path("runs/category-membership.jsonl"), type=pathlib.Path)
    args = ap.parse_args()

    if not args.pool.exists():
        sys.exit(f"no pool database at {args.pool}")

    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    lemma_categories: dict[str, set[str]] = {}
    for cat, label in CATEGORIES:
        print(f"walking Category:{cat}")
        try:
            members = list(category_members(cat, session))
        except Exception as exc:
            print(f"  request failed for {cat}: {exc}")
            continue
        kept = [m for m in members if is_lemma(m)]
        print(f"  fetched {len(members)}, kept {len(kept)} lemma-shaped")
        for lemma in kept:
            lemma_categories.setdefault(lemma.lower(), set()).add(label)
        time.sleep(1.0)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w") as fh:
        for lemma, labels in sorted(lemma_categories.items()):
            fh.write(
                json.dumps(
                    {"lemma": lemma, "categories": sorted(labels)},
                    ensure_ascii=False,
                )
                + "\n"
            )

    in_oewn = 0
    oewn_unlabelled = 0
    if args.pool.exists():
        con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
        for lemma, labels in lemma_categories.items():
            row = con.execute(
                """SELECT wik_first, wik_labels FROM lemma WHERE lemma = ?""",
                (lemma,),
            ).fetchone()
            if row is None:
                continue
            in_oewn += 1
            wik_first, wik_labels = (row[0] or ""), (row[1] or "")
            if not wik_first.strip() and not wik_labels.strip():
                oewn_unlabelled += 1
        con.close()

    print(f"distinct lemmas across categories: {len(lemma_categories)}")
    print(f"of which exist as OEWN lemmas in pool: {in_oewn}")
    print(f"of which have empty wik_first AND empty wik_labels: {oewn_unlabelled}")
    print(f"wrote membership records to {args.out}")


if __name__ == "__main__":
    main()
