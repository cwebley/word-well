"""PROTOTYPE (issue #57) — sample the v15 risk-gate challenge cohort.

The cohort has three slices:

1. **Forced-sampled at-risk**: headwords whose ``wik_labels`` carries any
   risk-bearing token anywhere. 80 headwords, stratified across risk axes and
   sense position so the model is asked about labels it should both recognise
   and miss.
2. **Handpicked obvious-negative controls**: 25 headwords that look at-risk
   but aren't (e.g. ``homegirl``, ``knackered``, ``polemics``,
   ``promiscuity``). Confirms the model isn't over-rejecting.
3. **All v14-kept headwords**: the 110 headwords v14 advanced under
   usefulness, to measure audience-risk leakage.

The file is committed under ``cases/`` and consumed by the v15 runner via the
unlabelled-set loader.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys

AT_RISK_TOKENS = {
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


def headword_lemmas(path: pathlib.Path) -> set[str]:
    if not path.exists():
        return set()
    spec = json.loads(path.read_text())
    entries = spec.get("cases") or spec.get("sample") or []
    return {entry["lemma"].lower() for entry in entries}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--v14-runs", type=pathlib.Path, default=pathlib.Path("runs"))
    ap.add_argument("--golden", type=pathlib.Path, required=True)
    ap.add_argument("--audit", type=pathlib.Path, required=True)
    ap.add_argument("--exploration", type=pathlib.Path, required=True)
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--at-risk-target", type=int, default=80)
    ap.add_argument("--controls", type=int, default=25)
    args = ap.parse_args()

    if not args.pool.exists():
        sys.exit(f"no pool at {args.pool}")

    con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    v14_keeps: set[str] = set()
    for path in args.v14_runs.glob("*.json"):
        record = json.loads(path.read_text())
        fp = record.get("fingerprint", {})
        if (
            fp.get("prompt_version") != "usefulness-prompt/14"
            or record.get("effective", {}).get("disposition") != "advance"
        ):
            continue
        headword = record["claim_id"].split("|", 1)[0].lower()
        v14_keeps.add(headword)
    print(f"v14 keeps: {len(v14_keeps)}")

    pool_size = con.execute("SELECT count(*) FROM lemma").fetchone()[0]
    print(f"pool: {pool_size:,} lemmas")

    risk_rows = con.execute(
        """
        SELECT lemma, display, wik_labels, wik_first, f_informal, zipf_summed,
               endorsements
        FROM lemma
        WHERE zipf_summed >= 1.0 AND zipf_summed < 3.8
        """
    ).fetchall()
    print(f"in-band lemmas: {len(risk_rows):,}")

    def carries_risk(row) -> bool:
        bag = (row["wik_labels"] or "").lower()
        first = (row["wik_first"] or "").lower()
        for token in AT_RISK_TOKENS:
            if token in bag or token in first:
                return True
        return False

    at_risk_pool = [row for row in risk_rows if carries_risk(row)]
    print(f"in-band + at-risk label: {len(at_risk_pool):,}")

    at_risk_stratify: dict[str, list[sqlite3.Row]] = {
        "first-sense": [],
        "non-first-sense": [],
        "f_informal=1": [],
        "endorsed": [],
    }
    for row in at_risk_pool:
        first = (row["wik_first"] or "").lower()
        bag = (row["wik_labels"] or "").lower()
        for token in AT_RISK_TOKENS:
            if token in first:
                at_risk_stratify["first-sense"].append(row)
                break
        else:
            at_risk_stratify["non-first-sense"].append(row)
        if row["f_informal"]:
            at_risk_stratify["f_informal=1"].append(row)
        if row["endorsements"]:
            at_risk_stratify["endorsed"].append(row)
    for bucket, items in at_risk_stratify.items():
        print(f"  {bucket}: {len(items)}")

    target = args.at_risk_target
    per_bucket = max(1, target // max(len(at_risk_stratify), 1))
    selected: list[sqlite3.Row] = []
    seen: set[str] = set()
    for items in at_risk_stratify.values():
        for row in items:
            if row["lemma"] in seen:
                continue
            selected.append(row)
            seen.add(row["lemma"])
            if len([r for r in selected if r in items]) >= per_bucket:
                break
    print(f"at-risk cohort: {len(selected)}")

    controls_seed = headword_lemmas(args.golden)
    explicit_controls = [
        "homegirl",
        "knackered",
        "polemics",
        "promiscuity",
        "exuberant",
        "braggart",
        "cadaver",
        "ogre",
        "thug",
        "cannibal",
        "villain",
        "scar",
        "wound",
        "bleed",
        "kill",
        "murder",
        "war",
        "fight",
        "stranger",
        "enemy",
        "rival",
        "contempt",
        "disdain",
        "scorn",
        "buffoon",
        "oaf",
        "taboo",
        "spite",
        "hate",
        "pity",
        "rage",
        "fear",
        "dread",
        "jealous",
    ]
    explicit_present = []
    for lemma in explicit_controls:
        row = con.execute(
            "SELECT lemma, display, wik_labels, wik_first, f_informal, zipf_summed, endorsements FROM lemma WHERE lemma = ?",
            (lemma,),
        ).fetchone()
        if row is None or row["lemma"] in controls_seed or carries_risk(row):
            continue
        explicit_present.append(row)
    print(f"explicit controls in pool: {len(explicit_present)}")
    if len(explicit_present) >= args.controls:
        selected_controls = explicit_present[: args.controls]
    else:
        filler = [
            row for row in risk_rows
            if not carries_risk(row)
            and row["lemma"] not in controls_seed
            and row["lemma"] not in {r["lemma"] for r in explicit_present}
        ]
        selected_controls = explicit_present + filler[: max(0, args.controls - len(explicit_present))]
    print(f"control cohort: {len(selected_controls)}")

    v14_keeps_in_band: list[sqlite3.Row] = []
    for lemma in v14_keeps:
        row = con.execute(
            "SELECT lemma, display, wik_labels, wik_first, f_informal, zipf_summed, endorsements FROM lemma WHERE lemma = ?",
            (lemma,),
        ).fetchone()
        if row is None:
            continue
        v14_keeps_in_band.append(row)
    print(f"v14 keeps in band: {len(v14_keeps_in_band)}")

    out_records: list[dict] = []
    for row in selected:
        out_records.append(
            {
                "lemma": row["lemma"],
                "display": row["display"],
                "cohort": "at-risk",
                "wik_first": row["wik_first"],
                "wik_labels": row["wik_labels"],
                "f_informal": bool(row["f_informal"]),
                "endorsements": row["endorsements"],
                "zipf_summed": row["zipf_summed"],
            }
        )
    for row in selected_controls:
        out_records.append(
            {
                "lemma": row["lemma"],
                "display": row["display"],
                "cohort": "control",
                "wik_first": row["wik_first"],
                "wik_labels": row["wik_labels"],
                "f_informal": bool(row["f_informal"]),
                "endorsements": row["endorsements"],
                "zipf_summed": row["zipf_summed"],
            }
        )
    for row in v14_keeps_in_band:
        out_records.append(
            {
                "lemma": row["lemma"],
                "display": row["display"],
                "cohort": "v14-keep",
                "wik_first": row["wik_first"],
                "wik_labels": row["wik_labels"],
                "f_informal": bool(row["f_informal"]),
                "endorsements": row["endorsements"],
                "zipf_summed": row["zipf_summed"],
            }
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"version": "risk-cohort/1", "records": out_records}, indent=2))
    print(f"wrote {len(out_records)} cohort records to {args.out}")


if __name__ == "__main__":
    main()
