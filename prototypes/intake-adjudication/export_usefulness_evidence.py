"""PROTOTYPE (issue #56) — materialise fixed lexical evidence for the usefulness gate.

Standalone by design, exactly like `build_mechanical_flags.py`. This does NOT
touch `export_evidence.py`: bumping `intake-evidence/*` would change every
`input_digest` and invalidate the frozen calibration partitions, their labels and
every persisted run fingerprint.

The unit here is not a headword and not a mechanical claim. It is one **source
meaning**, because stage 2 measured what grouping costs: three of its four errors
sat inside multi-sense groups sharing a rationale that was true only of the
easiest member. So this emits one record per (lemma, sense) and the judge is
asked once per meaning. Policy reassembles the headword afterwards.

What the judge sees is deliberately thin — the meaning, and the word's frequency.
Wiktionary register labels and the mechanical flags are both left out. Measured
against the golden twelve, `wik_labels` catches 2 of 6 rejects, misses 4, and
misinforms on two keeps: `pernicious` is tagged `obsolete` and `laconic` is
tagged `Australia,proscribed`, because the labels are headword-scoped while the
register belongs to one sense. Frequency, by contrast, is the only thing in the
evidence that separates `happy` from the words worth teaching.

Run:

    cd prototypes/content-pipeline-source-shapes
    ./venv/bin/python ../intake-adjudication/export_usefulness_evidence.py \
        --cases ../intake-adjudication/cases/usefulness-golden-v1.json \
        --out   ../intake-adjudication/evidence
"""

import argparse
import hashlib
import json
import pathlib
import sqlite3
import sys

import wn

# The extraction contract for this gate. Versioned separately from
# `intake-evidence/*` so the two can never invalidate one another.
EXTRACTION_VERSION = "usefulness-evidence/1"

MAX_EXAMPLES = 6


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_digest(obj):
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def source_meanings(en, display, normalized):
    """Every OEWN sense of a form, with the stable identifier the judge must cite."""
    out = []
    for form in (display, normalized):
        for word in en.words(form):
            for sense in word.senses():
                syn = sense.synset()
                examples = syn.examples()
                out.append({
                    "sense_id": sense.id,
                    "pos": word.pos,
                    "lemma": word.lemma(),
                    "definition": syn.definition(),
                    "examples": examples[:MAX_EXAMPLES],
                    "examples_truncated": len(examples) > MAX_EXAMPLES,
                    "synset_members": syn.lemmas(),
                })
        if out:
            break
    # OEWN can record the same sense under both forms; keep one of each.
    unique = {m["sense_id"]: m for m in out}
    return sorted(unique.values(), key=lambda m: m["sense_id"])


def build_records(en, con, case):
    """One record per source meaning of one headword."""
    lemma = case["lemma"]
    row = con.execute("SELECT * FROM lemma WHERE lemma = ?", (lemma.lower(),)).fetchone()
    if row is None:
        sys.exit(f"{lemma!r} is not in the candidate pool")

    meanings = source_meanings(en, row["display"], row["lemma"])
    if not meanings:
        sys.exit(f"{lemma!r} has no OEWN senses; it cannot be judged closed-book")

    candidate = {
        "normalized": row["lemma"],
        "display": row["display"],
        "pos": (row["pos"] or "").split(",") if row["pos"] else [],
        "zipf": row["zipf_summed"],
        "meaning_count": len(meanings),
    }

    records = []
    for meaning in meanings:
        missing = []
        if not meaning["definition"]:
            missing.append("meaning.definition")
        if candidate["zipf"] is None:
            missing.append("candidate.zipf")

        record = {
            "subject_id": f"{row['lemma']}|{meaning['sense_id']}",
            "extraction_version": EXTRACTION_VERSION,
            "candidate": candidate,
            "meaning": meaning,
            "missing_evidence": sorted(set(missing)),
        }
        # Endorsement is deliberately outside the judged payload. It never
        # reaches the prompt, and for this gate it never reaches policy either:
        # endorsed words are the retention audit's sample, and a gate that
        # advanced them by rule would make the audit report its own override.
        record["policy_context"] = {"endorsements": row["endorsements"]}
        record["input_digest"] = canonical_digest(
            {k: record[k] for k in ("subject_id", "extraction_version", "candidate",
                                    "meaning", "missing_evidence")})
        records.append(record)
    return records


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", required=True, type=pathlib.Path)
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--pool", default=pathlib.Path("pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--rules", default=pathlib.Path("build_pool.py"), type=pathlib.Path)
    ap.add_argument("--wn-data", default=pathlib.Path("data/wn"), type=pathlib.Path)
    args = ap.parse_args()

    if not args.pool.exists():
        sys.exit(f"no pool database at {args.pool}")

    wn.config.data_directory = args.wn_data.resolve()
    en = wn.Wordnet("oewn:2025")

    con = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row

    spec = json.loads(args.cases.read_text())
    case_set = spec.get("case_set", args.cases.stem)
    records = []
    for case in spec["cases"]:
        records.extend(build_records(en, con, case))
    records.sort(key=lambda r: r["subject_id"])

    args.out.mkdir(parents=True, exist_ok=True)
    jsonl = args.out / f"{case_set}.meanings.jsonl"
    with jsonl.open("w") as fh:
        for record in records:
            fh.write(json.dumps(record, sort_keys=True, separators=(",", ":"),
                                ensure_ascii=False) + "\n")

    manifest = {
        "case_set": case_set,
        "extraction_version": EXTRACTION_VERSION,
        "max_examples": MAX_EXAMPLES,
        "headword_count": len(spec["cases"]),
        "meaning_count": len(records),
        "sources": {
            "oewn": {"release": "oewn:2025", "retrieved_via": f"wn {wn.__version__}"},
            "wordfreq": {"version": "3.1.1", "wordlist": "large"},
            "candidate_pool": {"path": str(args.pool), "sha256": sha256_file(args.pool)},
        },
        "deterministic_rules": {
            "source": str(args.rules),
            "sha256": sha256_file(args.rules) if args.rules.exists() else None,
        },
        "claims": {r["subject_id"]: r["input_digest"] for r in records},
    }
    (args.out / f"{case_set}.manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n")

    by_word = {}
    for record in records:
        by_word.setdefault(record["candidate"]["display"], []).append(record)
    for display, group in by_word.items():
        marks = sorted({m for r in group for m in r["missing_evidence"]})
        print(f"{display:14} zipf={group[0]['candidate']['zipf']:<6} "
              f"meanings={len(group)} missing=[{', '.join(marks) or 'none'}]")
    print(f"\nwrote {len(records)} meanings across {len(by_word)} headwords to {jsonl}")


if __name__ == "__main__":
    main()
