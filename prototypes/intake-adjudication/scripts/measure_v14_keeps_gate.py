"""PROTOTYPE (issue #57) — measure how many V14 keeps the deterministic gate
would catch if it ran before V14.

Stage C of the four-stage plan. Reads:
- V14 keeps from runs/*.json (prompt_version=usefulness-prompt/14,
  effective.disposition=advance)
- category membership from runs/category-membership.jsonl
- pool label state

Then asks: if we ran the deterministic gate BEFORE V14 (i.e. as a
pre-filter on the candidate pool), how many V14 keeps would have been
blocked?

If the number is high, it confirms the deterministic gate belongs in
front of V14, not behind it.
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
    out: set[str] = set()
    for line in path.read_text().splitlines():
        if not line:
            continue
        rec = json.loads(line)
        out.add(rec["lemma"].lower())
    return out


def load_label_state(pool: pathlib.Path) -> dict[str, tuple[str, str]]:
    if not pool.exists():
        return {}
    con = sqlite3.connect(f"file:{pool}?mode=ro", uri=True)
    rows = con.execute("SELECT lemma, wik_first, wik_labels FROM lemma").fetchall()
    con.close()
    return {lemma: (first or "", labels or "") for lemma, first, labels in rows}


def gate_decision(lemma: str, membership: set[str], labels: dict[str, tuple[str, str]]) -> tuple[bool, str]:
    if lemma in membership:
        return True, "category-membership"
    first, labels_csv = labels.get(lemma, ("", ""))
    haystack = " ".join([first, labels_csv]).lower()
    for token in RISK_TOKENS:
        if token in haystack.split(",") or token in haystack:
            return True, f"label:{token}"
    return False, "no-signal"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--membership", default=pathlib.Path("runs/category-membership.jsonl"), type=pathlib.Path)
    ap.add_argument("--runs", default=pathlib.Path("runs"), type=pathlib.Path)
    args = ap.parse_args()

    membership = load_membership(args.membership)
    labels = load_label_state(args.pool)

    v14_keeps: set[str] = set()
    for path in args.runs.glob("*.json"):
        record = json.loads(path.read_text())
        fp = record.get("fingerprint", {})
        if (
            fp.get("prompt_version") != "usefulness-prompt/14"
            or (record.get("effective") or {}).get("disposition") != "advance"
        ):
            continue
        headword = record["claim_id"].split("|", 1)[0].lower()
        v14_keeps.add(headword)

    print(f"V14 keeps: {len(v14_keeps)}")

    blocked = []
    survived = []
    for lemma in sorted(v14_keeps):
        would_block, reason = gate_decision(lemma, membership, labels)
        if would_block:
            blocked.append((lemma, reason))
        else:
            survived.append(lemma)

    print(f"deterministic gate would block: {len(blocked)}")
    print(f"deterministic gate would let through: {len(survived)}")
    if blocked:
        print("blocked by deterministic gate:")
        for lemma, reason in blocked:
            print(f"  {lemma:25} {reason}")


if __name__ == "__main__":
    main()
