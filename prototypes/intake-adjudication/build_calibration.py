"""Freeze the twelve human-reviewed morphology calibration cases."""

import hashlib
import json
import pathlib


PARTITION_VERSION = "morphology-calibration/2"
GOLDEN_CLAIMS = {
    "rebut|affix_strip": "affix_strip",
    "fruitfulness|affix_strip": "affix_strip",
    "pastoral|compound_split": "compound_split",
    "nighthawk|compound_split": "compound_split",
    "sameness|grammatical_derivation": "grammatical_derivation",
    "tightness|grammatical_derivation": "grammatical_derivation",
    "mercurial|meaning_shift_derivation": "meaning_shift_derivation",
    "ringer|meaning_shift_derivation": "meaning_shift_derivation",
    "convoluted|lexicalised_participle": "lexicalised_participle",
    "nonplussed|lexicalised_participle": "lexicalised_participle",
    "handspring|compound_split": "stress",
    "sheepskin|compound_split": "stress",
}


def select_members(claims, metadata):
    claims_by_id = {claim["claim_id"]: claim for claim in claims}
    members = []
    for claim_id, primary_slice in GOLDEN_CLAIMS.items():
        claim = claims_by_id.get(claim_id)
        if claim is None:
            raise ValueError(f"golden claim is absent from evidence: {claim_id}")
        members.append(
            {
                "claim_id": claim_id,
                "input_digest": claim["input_digest"],
                "rule_kind": claim["claim"]["rule_kind"],
                "primary_slice": primary_slice,
                "coverage_tags": sorted(
                    set(metadata[claim_id]["coverage_tags"]) | {"human_review_set"}
                ),
                "partition": "development",
            }
        )
    return sorted(members, key=lambda member: member["claim_id"])


def main():
    root = pathlib.Path(__file__).parent
    silver_spec = json.loads((root / "cases/calibration-silver.claims.json").read_text())
    manifest_path = root / "evidence/calibration-silver.manifest.json"
    claims = [
        json.loads(line)
        for line in (root / "evidence/calibration-silver.claims.jsonl").read_text().splitlines()
        if line
    ]
    metadata = {
        f"{case['lemma']}|{case['rule_kind']}": case for case in silver_spec["claims"]
    }
    members = select_members(claims, metadata)

    output = {
        "partition_version": PARTITION_VERSION,
        "sampling_version": silver_spec["sampling_version"],
        "sampling_seed": silver_spec["seed"],
        "evidence_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        "quarantine_coverage": {
            "decision": "real_post_filter_workload",
            "note": "Rootless claims filtered before adjudication are not manufactured as golden cases; synthetic insufficiency remains in policy tests.",
        },
        "dataset_size_decision": {
            "original_plan": "200 cases: 120 development, 40 regression, 40 hidden holdout",
            "selected": "12 challenging human-reviewed development cases with at least two claims from every rule kind",
            "reason": "The human review burden was too high. All prior human and agent labels were discarded, and the user requested a fresh difficult set.",
            "limitations": "There is no regression or hidden holdout partition. Later accuracy, reliability, and holdout claims require additional human-reviewed cases.",
        },
        "members": members,
    }
    (root / "cases/calibration-v1.partitions.json").write_text(
        json.dumps(output, indent=2, sort_keys=True) + "\n"
    )
    (root / "cases/prompt-smoke.claim-ids.json").write_text(
        json.dumps(
            {"partition_version": PARTITION_VERSION, "claim_ids": list(GOLDEN_CLAIMS)},
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    print("wrote 12 human-review cases, all in development")


if __name__ == "__main__":
    main()
