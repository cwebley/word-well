"""PROTOTYPE (issue #56) — draw the retention audit sample.

The retention audit is the one holdout that costs no labelling time, because
editors already did the work: every word in it was nominated by at least one
editorial source. It reports exactly one number — the share of endorsed words the
usefulness gate keeps — and it exists to catch unexplained movement in that
number, never to be scored against or tuned toward.

Three properties make it worth having, and losing any one makes it worthless:

  unlabelled    Nobody assigns a verdict to these words. The moment someone does,
                it becomes a second golden set with all the labelling problems the
                first one was cut down to avoid.

  disjoint      No word here may appear in a golden case. Endorsement can seed
                golden cases *or* serve as the independent audit, never both on
                the same words: tuning against endorsed words makes the audit
                report its own training signal back as a retention rate. This is
                enforced below and tested in `evals/retention-audit.test.ts`.

  untuned       A drop in retention is a question, not a target. Raising it by
                editing the prompt until it goes up is how the instrument stops
                measuring anything.

Sampling is proportional allocation within strata, by endorsement count band,
frequency band and part of speech. Not a minimum per cell: 2,906 endorsed
headwords spread over 63 cells, 13 of which hold fewer than three words, so a
per-cell floor would over-represent the thin corners and under-represent the
bulk. Largest remainder settles the rounding.

The seed is fixed and recorded. Re-running with the same pool and seed reproduces
the sample exactly, which is what lets a later retention number be compared
against an earlier one at all.

Run:

    cd prototypes/content-pipeline-source-shapes
    ./venv/bin/python ../intake-adjudication/sample_retention_audit.py \
        --out ../intake-adjudication/cases/retention-audit-v1.json
"""

import argparse
import hashlib
import json
import pathlib
import random
import sqlite3
import sys

SEED = 20260830
TARGET = 100

# Bands are deliberately coarse. They exist to keep the sample from drifting
# toward one corner of the population, not to support per-band claims: 100 words
# over 63 cells supports no per-cell statistics and none are reported.
ENDORSEMENT_BANDS = [(1, 1, "1"), (2, 3, "2-3"), (4, 7, "4-7"), (8, 10**6, "8+")]
ZIPF_BANDS = [(0.0, 2.0, "<2.0"), (2.0, 2.5, "2.0-2.5"), (2.5, 3.0, "2.5-3.0"),
              (3.0, 3.5, "3.0-3.5"), (3.5, 10.0, "3.5+")]
POS_NAMES = {"n": "noun", "v": "verb", "a": "adj", "s": "adj", "r": "adv"}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def endorsement_band(count):
    for low, high, name in ENDORSEMENT_BANDS:
        if low <= count <= high:
            return name
    return ENDORSEMENT_BANDS[-1][2]


def zipf_band(zipf):
    if zipf is None:
        return "missing"
    for low, high, name in ZIPF_BANDS:
        if low <= zipf < high:
            return name
    return ZIPF_BANDS[-1][2]


def pos_band(pos):
    return POS_NAMES.get((pos or "").split(",")[0], "other")


def allocate(cells, target):
    """Proportional allocation with largest-remainder rounding.

    Ties break on the stratum key so the allocation is a function of the
    population alone, not of dictionary ordering.
    """
    total = sum(len(members) for members in cells.values())
    exact = {key: len(members) * target / total for key, members in cells.items()}
    quota = {key: min(int(value), len(cells[key])) for key, value in exact.items()}

    while sum(quota.values()) < target:
        candidates = [key for key in cells if quota[key] < len(cells[key])]
        if not candidates:
            break
        key = max(candidates, key=lambda k: (exact[k] - quota[k], k))
        quota[key] += 1
    return quota


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--golden", type=pathlib.Path,
                    default=pathlib.Path("../intake-adjudication/cases/usefulness-golden-v1.json"))
    ap.add_argument("--target", type=int, default=TARGET)
    ap.add_argument("--seed", type=int, default=SEED)
    args = ap.parse_args()

    if not args.pool.exists():
        sys.exit(f"no pool database at {args.pool}")

    golden = {c["lemma"].lower() for c in json.loads(args.golden.read_text())["cases"]}

    con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rows = [dict(r) for r in con.execute(
        "SELECT lemma, display, pos, zipf_summed, endorsements, oewn_senses "
        "FROM lemma WHERE endorsements > 0 ORDER BY lemma")]

    eligible = [r for r in rows if r["lemma"] not in golden]
    excluded = len(rows) - len(eligible)

    cells = {}
    for row in eligible:
        key = (endorsement_band(row["endorsements"]),
               zipf_band(row["zipf_summed"]),
               pos_band(row["pos"]))
        cells.setdefault(key, []).append(row)
    for members in cells.values():
        members.sort(key=lambda r: r["lemma"])

    quota = allocate(cells, args.target)

    rng = random.Random(args.seed)
    sample = []
    for key in sorted(cells):
        take = quota[key]
        if take:
            sample.extend(rng.sample(cells[key], take))
    sample.sort(key=lambda r: r["lemma"])

    assert not ({r["lemma"] for r in sample} & golden), "audit sample overlaps the golden set"

    payload = {
        "set_version": "retention-audit/1",
        "gate": "audience-usefulness",
        "issue": 56,
        "note": [
            "UNLABELLED BY DESIGN. Do not add a verdict to any word in this file.",
            "It reports one number: the share of these endorsed words the gate keeps.",
            "Never tune the prompt toward that number. A drop is a question, not a target.",
            "Disjoint from cases/usefulness-golden-v1.json, which is what keeps it",
            "independent evidence rather than a second read on the training signal.",
        ],
        "sampling": {
            "population": "candidate pool headwords with endorsements > 0",
            "population_size": len(rows),
            "eligible_after_golden_exclusion": len(eligible),
            "excluded_as_golden": excluded,
            "method": "proportional allocation within strata, largest remainder",
            "strata": ["endorsement_band", "zipf_band", "pos"],
            "seed": args.seed,
            "target": args.target,
            "pool_sha256": sha256_file(args.pool),
        },
        "strata_counts": {
            "|".join(key): {"population": len(cells[key]), "sampled": quota[key]}
            for key in sorted(cells) if quota[key]
        },
        "sample": [
            {"lemma": r["lemma"], "display": r["display"], "pos": r["pos"],
             "zipf_summed": r["zipf_summed"], "endorsements": r["endorsements"],
             "oewn_senses": r["oewn_senses"]}
            for r in sample
        ],
    }
    args.out.write_text(json.dumps(payload, indent=2) + "\n")

    print(f"population {len(rows)} endorsed headwords, {excluded} excluded as golden")
    print(f"sampled {len(sample)} across {sum(1 for k in quota if quota[k])} strata cells, seed {args.seed}")
    for name, index in [("endorsements", 0), ("zipf", 1), ("pos", 2)]:
        counts = {}
        for key in sorted(cells):
            if quota[key]:
                counts[key[index]] = counts.get(key[index], 0) + quota[key]
        print(f"  {name:13} {dict(sorted(counts.items()))}")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
