"""PROTOTYPE (issue #57) — measure the unlabeled residual population.

Stage D of the four-stage plan. Reads:
- category membership from runs/category-membership.jsonl
- pool label state from pool.sqlite

For every lemma in the pool that:
1. Is in the Zipf delivery band (1.0-3.8)
2. Has empty wik_first AND empty wik_labels in the pool

Compute:
- How many are on Wiktionary's offensive category list (deterministic gate
  catches them via category membership).
- How many are NOT on any list (these are the unlabeled residuals that would
  need V15's LLM judge).

Also report:
- Among the OFFENSIVE labels in wik_first or wik_labels, how many are NOT in
  any category (gate catches them via the label fallback, not category).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3

RISK_TOKENS = {
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
    "racially offensive",
    "homophobic",
    "transphobic",
    "misogynistic",
}


def load_membership(path: pathlib.Path) -> set[str]:
    if not path.exists():
        return set()
    return {
        json.loads(line)["lemma"].lower()
        for line in path.read_text().splitlines()
        if line
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--membership", default=pathlib.Path("runs/category-membership.jsonl"), type=pathlib.Path)
    args = ap.parse_args()

    membership = load_membership(args.membership)
    print(f"category membership: {len(membership)} lemmas")

    con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    in_band = con.execute(
        "SELECT lemma, wik_first, wik_labels FROM lemma WHERE zipf_summed >= 1.0 AND zipf_summed < 3.8"
    ).fetchall()
    print(f"in-band lemmas: {len(in_band):,}")

    unlabeled_in_band = [
        r for r in in_band
        if not (r["wik_first"] or "").strip() and not (r["wik_labels"] or "").strip()
    ]
    print(f"in-band AND empty wik_first + empty wik_labels: {len(unlabeled_in_band):,}")

    unlabeled_in_category = [r for r in unlabeled_in_band if r["lemma"] in membership]
    unlabeled_unflagged = [r for r in unlabeled_in_band if r["lemma"] not in membership]
    print(f"  in Wiktionary category list (caught by category gate): {len(unlabeled_in_category):,}")
    print(f"  NOT in category list (unlabeled residual for V15): {len(unlabeled_unflagged):,}")

    labelled_risky = [
        r for r in in_band
        if any(t in (r["wik_first"] or "").lower().split(",") + (r["wik_labels"] or "").lower().split(",")
               for t in RISK_TOKENS)
    ]
    print(f"in-band AND wik_first/labels contain a risk token: {len(labelled_risky):,}")
    in_cat_and_label = [r for r in labelled_risky if r["lemma"] in membership]
    label_only = [r for r in labelled_risky if r["lemma"] not in membership]
    print(f"  also on category list: {len(in_cat_and_label):,}")
    print(f"  label-only (gate catches via wik_first/labels): {len(label_only):,}")

    print("\nThe unlabeled residual population (the V15 LLM gate's job):")
    print(f"  unflagged by category: {len(unlabeled_unflagged):,}")
    print("Sample (first 15):")
    for row in unlabeled_unflagged[:15]:
        print(f"  {row['lemma']}")


if __name__ == "__main__":
    main()
