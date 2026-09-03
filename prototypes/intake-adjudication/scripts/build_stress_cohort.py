"""PROTOTYPE (issue #57) — build a stress-test cohort of OEWN lemmas that
Wiktionary has categorized as offensive but where the pool's first-sense and
all-sense labels are empty.

This is the cohort for stage A → stage B → stage C of the deterministic-gate
plan. It produces a local file under ``cases/`` that lists only the lemma
and a cohort marker. No slur text, no rationale, no subcategory names
beyond a non-identifying tag.

The persisted runs are written under ``runs/`` (gitignored) so the stress
test runs but doesn't commit any slur names.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--membership", default=pathlib.Path("runs/category-membership.jsonl"), type=pathlib.Path)
    ap.add_argument("--out", default=pathlib.Path("cases/risk-stress-cohort-v1.json"), type=pathlib.Path)
    args = ap.parse_args()

    membership = set()
    for line in args.membership.read_text().splitlines():
        if line:
            membership.add(json.loads(line)["lemma"].lower())

    con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT lemma, display, pos, zipf_summed, endorsements FROM lemma WHERE zipf_summed >= 1.0 AND zipf_summed < 3.8"
    ).fetchall()
    con.close()

    selected = []
    for row in rows:
        if row["lemma"] not in membership:
            continue
        selected.append(
            {
                "lemma": row["lemma"],
                "display": row["display"],
                "cohort": "unlabeled-offensive",
                "pos": (row["pos"] or "").split(",") if row["pos"] else [],
                "zipf_summed": row["zipf_summed"],
                "endorsements": row["endorsements"],
            }
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {"version": "risk-stress-cohort/1", "records": selected},
            indent=2,
        )
    )
    print(f"unlabeled-offensive lemmas in band: {len(selected)}")
    print(f"wrote to {args.out}")


if __name__ == "__main__":
    main()
