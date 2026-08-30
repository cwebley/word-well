"""Assemble a deterministic, stratified silver pool for morphology calibration.

This script chooses mechanical claims. ``export_evidence.py`` remains the only
code that materialises the fixed evidence shown to reviewers and models.
"""

import argparse
import dataclasses
import hashlib
import json
import pathlib
import sqlite3


SAMPLING_VERSION = "morphology-silver/1"
DEFAULT_SEED = "wordwell-morphology-calibration-v1"
RULE_KINDS = (
    "affix_strip",
    "compound_split",
    "grammatical_derivation",
    "meaning_shift_derivation",
    "lexicalised_participle",
)
COVERAGE_TAGS = (
    "endorsed",
    "unendorsed",
    "polysemous",
    "multi_flag",
)
KNOWN_REGRESSIONS = {
    "rebut|affix_strip",
    "distrait|affix_strip",
    "injunction|affix_strip",
    "pastoral|compound_split",
    "deism|affix_strip",
    "fleeting|lexicalised_participle",
    "naughtiness|grammatical_derivation",
    "mercurial|meaning_shift_derivation",
    "convoluted|lexicalised_participle",
    "nonplussed|lexicalised_participle",
}


@dataclasses.dataclass(frozen=True)
class CandidateClaim:
    lemma: str
    rule_kind: str
    tags: frozenset[str]

    @property
    def claim_id(self):
        return f"{self.lemma}|{self.rule_kind}"


def stable_rank(claim_id, seed):
    return hashlib.sha256(
        f"{SAMPLING_VERSION}\0{seed}\0{claim_id}".encode("utf-8")
    ).hexdigest()


def select_stratified(
    claims,
    quota,
    seed,
    coverage_tags=COVERAGE_TAGS,
    minimum_per_tag=10,
):
    """Satisfy overlapping coverage floors, then fill by stable hash rank."""
    ranked = sorted(claims, key=lambda claim: stable_rank(claim.claim_id, seed))
    selected = []
    selected_ids = set()

    def add(claim):
        if claim.claim_id not in selected_ids:
            selected.append(claim)
            selected_ids.add(claim.claim_id)

    for claim in ranked:
        if "known_regression" in claim.tags:
            add(claim)

    for tag in coverage_tags:
        matching = [claim for claim in ranked if tag in claim.tags]
        if len(matching) < minimum_per_tag:
            raise ValueError(
                f"stratum {tag!r} has {len(matching)} claims, needs {minimum_per_tag}"
            )
        already = sum(tag in claim.tags for claim in selected)
        for claim in matching:
            if already >= minimum_per_tag:
                break
            if claim.claim_id not in selected_ids:
                add(claim)
                already += 1

    for claim in ranked:
        if len(selected) >= quota:
            break
        add(claim)

    if len(selected) != quota:
        raise ValueError(f"only {len(selected)} claims available for quota {quota}")
    return sorted(selected, key=lambda claim: claim.claim_id)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_lexicalised_participle(row):
    return (
        row["f_derived_soft"]
        and row["lemma"].endswith(("ed", "ing"))
        and "a" in (row["pos"] or "")
    )


def enumerate_claims(connection):
    # This is the measured delivery-band workload from the source-shapes study:
    # fuzzy morphology flags, source-resolved abstract vocabulary, and no factual
    # exclusion. It reproduces 4,722 / 2,090 / 1,619 / 7,587 on the pinned pool.
    rows = connection.execute(
        """
        SELECT * FROM lemma
        WHERE zipf_summed >= 1.0 AND zipf_summed < 3.8
          AND f_abstract = 1
          AND f_blocked = 0
          AND f_roman = 0
          AND f_variant = 0
          AND f_british = 0
          AND f_ology = 0
        """
    ).fetchall()

    claims = []
    for row in rows:
        rule_kinds = []
        if row["f_transparent"]:
            rule_kinds.append("affix_strip")
        if row["f_compound"]:
            rule_kinds.append("compound_split")
        if row["f_derived"]:
            rule_kinds.append("grammatical_derivation")
        if row["f_derived_soft"]:
            rule_kinds.append(
                "lexicalised_participle"
                if is_lexicalised_participle(row)
                else "meaning_shift_derivation"
            )

        for rule_kind in rule_kinds:
            claim_id = f"{row['lemma']}|{rule_kind}"
            tags = {
                "endorsed" if row["endorsements"] else "unendorsed",
                "polysemous" if row["oewn_senses"] > 1 else "single_meaning",
            }
            if len(rule_kinds) > 1:
                tags.add("multi_flag")
            if row["wik_first"]:
                tags.add("wiktionary_label")
            if claim_id in KNOWN_REGRESSIONS:
                tags.add("known_regression")
            claims.append(CandidateClaim(row["lemma"], rule_kind, frozenset(tags)))
    return claims


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--pool",
        type=pathlib.Path,
        default=pathlib.Path("../content-pipeline-source-shapes/pool.sqlite"),
    )
    parser.add_argument(
        "--out",
        type=pathlib.Path,
        default=pathlib.Path("cases/calibration-silver.claims.json"),
    )
    parser.add_argument("--seed", default=DEFAULT_SEED)
    parser.add_argument("--per-rule", type=int, default=250)
    args = parser.parse_args()

    if not args.pool.exists():
        raise SystemExit(f"candidate pool does not exist: {args.pool}")
    connection = sqlite3.connect(args.pool)
    connection.row_factory = sqlite3.Row
    candidates = enumerate_claims(connection)

    selected = []
    available_counts = {}
    for rule_kind in RULE_KINDS:
        available = [claim for claim in candidates if claim.rule_kind == rule_kind]
        available_counts[rule_kind] = len(available)
        selected.extend(
            select_stratified(available, args.per_rule, args.seed)
        )

    cases = []
    coverage_counts = {}
    for claim in sorted(selected, key=lambda item: item.claim_id):
        tags = sorted(claim.tags)
        cases.append(
            {
                "lemma": claim.lemma,
                "rule_kind": claim.rule_kind,
                "coverage_tags": tags,
                "sampling_rank": stable_rank(claim.claim_id, args.seed),
            }
        )
        for tag in tags:
            coverage_counts[tag] = coverage_counts.get(tag, 0) + 1

    if coverage_counts.get("wiktionary_label", 0) < 10:
        raise ValueError("selected silver claims contain fewer than 10 Wiktionary-labelled cases")

    output = {
        "case_set": "calibration-silver",
        "sampling_version": SAMPLING_VERSION,
        "seed": args.seed,
        "candidate_pool": {
            "path": str(args.pool),
            "sha256": sha256_file(args.pool),
        },
        "available_claims_by_rule": available_counts,
        "selected_claims_by_rule": {
            rule_kind: args.per_rule for rule_kind in RULE_KINDS
        },
        "coverage_counts": coverage_counts,
        "claims": cases,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(f"wrote {len(cases)} silver claim specifications to {args.out}")
    print(json.dumps(coverage_counts, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
