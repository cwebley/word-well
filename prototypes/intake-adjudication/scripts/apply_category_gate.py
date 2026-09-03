"""PROTOTYPE (issue #57) — apply the deterministic category-membership gate to
a V15 result set and report what survives.

Stage B of the four-stage plan. Confirms whether the deterministic gate is
sufficient on the labelled majority, before we measure the unlabeled residual.

This script does NOT call any model. It just reads:
- runs/category-membership.jsonl (output of walk_offensive_categories.py)
- runs/*.json (V15 records)

And prints a comparison table:
- For each cohort in the V15 result set, how many were caught by the
  deterministic gate alone (category membership + Wiktionary first-sense
  labels).
- How many slipped through to need the LLM judge.

The gate inputs, in priority order:
1. Category membership (Wiktionary has marked this lemma as offensive).
2. Pool wik_first contains a risk token (first-sense labelled).
3. Pool wik_labels contains a risk token (any-sense labelled).
"""
from __future__ import annotations

import json
import pathlib
import sqlite3
import sys
from collections import Counter

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
    out: set[str] = set()
    for line in path.read_text().splitlines():
        if not line:
            continue
        rec = json.loads(line)
        lemma = rec["lemma"].lower()
        out.add(lemma)
    return out


def load_label_state(pool: pathlib.Path) -> dict[str, tuple[str, str]]:
    """{lemma: (wik_first_csv, wik_labels_csv)} from the pool."""
    if not pool.exists():
        return {}
    con = sqlite3.connect(f"file:{pool}?mode=ro", uri=True)
    rows = con.execute("SELECT lemma, wik_first, wik_labels FROM lemma").fetchall()
    con.close()
    return {lemma: (first or "", labels or "") for lemma, first, labels in rows}


def gate_decision(
    lemma: str,
    membership: set[str],
    labels: dict[str, tuple[str, str]],
) -> tuple[bool, str]:
    """Return (would_block, reason)."""
    if lemma in membership:
        return True, "category-membership"
    first, labels_csv = labels.get(lemma, ("", ""))
    haystack = " ".join([first, labels_csv]).lower()
    for token in RISK_TOKENS:
        if f" {token}" in f" {haystack}" or token in haystack.split(","):
            return True, f"label:{token}"
    return False, "no-signal"


def main() -> None:
    ap_parse = None
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path
    )
    ap.add_argument(
        "--membership", default=pathlib.Path("runs/category-membership.jsonl"), type=pathlib.Path
    )
    ap.add_argument("--runs", default=pathlib.Path("runs"), type=pathlib.Path)
    args = ap.parse_args()

    membership = load_membership(args.membership)
    labels = load_label_state(args.pool)
    print(f"category membership: {len(membership)} lemmas")
    print(f"label state: {len(labels)} lemmas in pool")

    cohort_records: dict[str, list[dict]] = {}
    for path in args.runs.glob("*.json"):
        record = json.loads(path.read_text())
        fp = record.get("fingerprint", {})
        if fp.get("prompt_version") != "usefulness-prompt/15":
            continue
        finding = record.get("finding") or {}
        if "audience_risk" not in finding:
            continue
        lemma = record["claim_id"].lower()
        cohort_records.setdefault("v15", []).append(
            {
                "lemma": lemma,
                "v15_disposition": (record.get("effective") or {}).get("disposition"),
                "v15_risk": finding.get("audience_risk"),
            }
        )

    blocked_by_gate = 0
    survived_gate = 0
    survived_blocked_by_v15 = 0
    blocked_by_category = 0
    blocked_by_label = 0
    survivors: list[dict] = []
    for entry in cohort_records.get("v15", []):
        would_block, reason = gate_decision(entry["lemma"], membership, labels)
        if would_block:
            blocked_by_gate += 1
            if reason == "category-membership":
                blocked_by_category += 1
            else:
                blocked_by_label += 1
        else:
            survived_gate += 1
            survivors.append(entry)
            if entry["v15_disposition"] == "exclude":
                survived_blocked_by_v15 += 1

    total = len(cohort_records.get("v15", []))
    print(f"\nV15 result set: {total} headwords")
    print(f"deterministic gate blocks: {blocked_by_gate}")
    print(f"  category membership: {blocked_by_category}")
    print(f"  label token: {blocked_by_label}")
    print(f"survived deterministic gate: {survived_gate}")
    print(f"  of which V15 had disposition=exclude: {survived_blocked_by_v15}")
    print(f"  of which V15 had risk=blocked: {sum(1 for s in survivors if s['v15_risk'] == 'blocked')}")
    print(f"  of which V15 had risk=sensitive: {sum(1 for s in survivors if s['v15_risk'] == 'sensitive')}")
    print(f"  of which V15 had risk=clear: {sum(1 for s in survivors if s['v15_risk'] == 'clear')}")

    if survivors:
        print("\nsample survivors (deterministic gate missed, V15 still caught):")
        for entry in [s for s in survivors if s["v15_risk"] != "clear"][:10]:
            print(f"  {entry['lemma']:25} v15 {entry['v15_disposition']} ({entry['v15_risk']})")


if __name__ == "__main__":
    main()
