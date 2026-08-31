"""PROTOTYPE (issue #56) — draw an exploration sample.

The third pool, and the only one new golden cases may come from.

  golden        labelled, tuned against, grows
  audit         unlabelled, frozen, never tuned toward, never harvested
  exploration   unlabelled, disposable, drawn fresh each cycle  <- this

The distinction that matters is between the audit and this. Both are unlabelled
samples the gate is run over. But the audit is a fixed instrument whose whole
value is that it does not change, so taking words out of it — especially the
words the gate failed — would bias it upward every cycle until it reported a
rising retention rate while detecting nothing. Exploration exists to be consumed:
draw it, run it, read it, promote what is interesting into the golden set, throw
the rest away, draw again next cycle with a different seed.

It is also the only sample shaped like the job. The golden twelve are hand-picked
obvious cases; the audit is 100% editorially endorsed. But 47,954 of the pool's
50,860 headwords — 94% — were never nominated by anyone, and that is the
population the gate will spend its life judging. This draws from the frequency
band a production run would plausibly cover, at random, with no editorial filter.

Run:

    cd prototypes/content-pipeline-source-shapes
    ./venv/bin/python ../intake-adjudication/sample_exploration.py --draw 1 \
        --out ../intake-adjudication/cases
"""

import argparse
import hashlib
import json
import pathlib
import random
import sqlite3
import sys

import intake_filters

TARGET = 150


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def already_used(cases_dir, skip):
    """Every lemma any existing set has touched, so draws never overlap.

    Reads whatever is there rather than naming files: a golden set that grows, an
    audit that must stay frozen, and previous exploration draws whose promoted
    cases are now golden. Missing files are fine; an empty exclusion set just
    means this is the first draw.

    `skip` is the file this run is about to write. Without it, redrawing the same
    number excludes its own previous output and silently produces a different
    sample — which would make a seeded draw unreproducible, the one property it
    exists to have.
    """
    used = {}
    for path in sorted(cases_dir.glob("*.json")):
        if path.name == skip:
            continue
        try:
            spec = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for entry in (spec.get("cases") or []) + (spec.get("sample") or []):
            lemma = entry.get("lemma")
            if lemma:
                used.setdefault(lemma.lower(), path.name)
    return used


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--draw", required=True, type=int, help="draw number; also seeds the sample")
    ap.add_argument("--out", required=True, type=pathlib.Path, help="cases directory")
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--target", type=int, default=TARGET)
    args = ap.parse_args()

    if not args.pool.exists():
        sys.exit(f"no pool database at {args.pool}")

    name = f"exploration-draw-{args.draw}"
    used = already_used(args.out, skip=f"{name}.json")

    con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    # The deterministic filters run first, from their single definition. Draw 1
    # did not, and paid model prices to be told that `xxi` is a roman numeral and
    # `vapour` is a British spelling — 8% of that draw.
    rows = [dict(r) for r in con.execute(
        f"SELECT * FROM lemma WHERE {intake_filters.WHERE} ORDER BY lemma")]

    eligible = [r for r in rows if r["lemma"] not in used]
    excluded = len(rows) - len(eligible)
    if len(eligible) < args.target:
        sys.exit(f"only {len(eligible)} eligible headwords for a target of {args.target}")

    # Simple random, not stratified. The audit is stratified because it must stay
    # comparable to itself over time; exploration wants the population's own
    # shape, including how much of it is rare and unendorsed.
    seed = 20260830 + args.draw
    sample = random.Random(seed).sample(eligible, args.target)
    sample.sort(key=lambda r: r["lemma"])

    assert not ({r["lemma"] for r in sample} & set(used)), "exploration overlaps an existing set"

    payload = {
        "set_version": f"exploration/{args.draw}",
        "gate": "audience-usefulness",
        "issue": 56,
        "note": [
            "UNLABELLED AND DISPOSABLE. Run it, read it, promote interesting cases",
            "into the golden set, discard the rest. Draw again with a new --draw.",
            "",
            "This is the only sample new golden cases may come from. Promoting a word",
            "the retention audit rejected would bias the audit upward every cycle.",
        ],
        "sampling": {
            "population": "candidate pool headwords that pass the deterministic filters",
            "filter_version": intake_filters.FILTER_VERSION,
            "zipf_band": [intake_filters.ZIPF_FLOOR, intake_filters.ZIPF_CEILING],
            "population_size": len(rows),
            "eligible_after_exclusions": len(eligible),
            "excluded_as_already_used": excluded,
            "method": "simple random, unstratified",
            "seed": seed,
            "draw": args.draw,
            "target": args.target,
            "pool_sha256": sha256_file(args.pool),
        },
        "sample": [
            {"lemma": r["lemma"], "display": r["display"], "pos": r["pos"],
             "zipf_summed": r["zipf_summed"], "endorsements": r["endorsements"],
             "oewn_senses": r["oewn_senses"]}
            for r in sample
        ],
    }
    out = args.out / f"{name}.json"
    out.write_text(json.dumps(payload, indent=2) + "\n")

    endorsed = sum(1 for r in sample if r["endorsements"] > 0)
    senses = sum(r["oewn_senses"] for r in sample)
    print(f"population {len(rows):,} passing {intake_filters.FILTER_VERSION}, {excluded} excluded as already used")
    print(f"drew {len(sample)} headwords, {senses} senses, seed {seed}")
    print(f"  endorsed: {endorsed} ({endorsed / len(sample):.0%})  — the population itself is {sum(1 for r in rows if r['endorsements'] > 0) / len(rows):.0%}")
    zipfs = sorted(r["zipf_summed"] for r in sample)
    print(f"  zipf: min {zipfs[0]}, median {zipfs[len(zipfs) // 2]}, max {zipfs[-1]}")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
