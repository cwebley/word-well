"""PROTOTYPE (issue #48) — materialise fixed lexical evidence for mechanical claims.

Reads the scratch candidate pool from spike #44 plus the pinned OEWN release and
writes one JSONL line per claim. Morphology adjudication is closed-book, so this
file is the *entire* world the judge sees: whatever is missing here must be
marked missing rather than left for the model to fill in from memory.

Deliberately not production code. No schema, no migration. Run:

    cd prototypes/content-pipeline-source-shapes
    ./venv/bin/python ../intake-adjudication/export_evidence.py \
        --cases ../intake-adjudication/cases/contract-test.claims.json \
        --out   ../intake-adjudication/evidence
"""

import argparse
import hashlib
import json
import pathlib
import sqlite3
import sys

import wn

# The extraction contract. Bump when the shape or content of an emitted claim
# changes, because the config fingerprint keys persisted model output on it.
EXTRACTION_VERSION = "intake-evidence/2"

# Cap on examples carried per source meaning. A fixed, versioned truncation rule
# rather than an ad-hoc one, so two exports of the same claim are byte-identical.
MAX_EXAMPLES = 6

# Copied verbatim from build_pool.py so the affix that fired can be recovered
# from (word, root). Drift between the two lists would silently mislabel claims,
# so export_evidence asserts the recovered affix actually reconstructs the word.
PRE = ["un", "in", "im", "ir", "il", "non", "de", "re", "over", "under", "anti", "micro",
       "macro", "pre", "post", "semi", "sub", "super", "multi", "inter", "counter",
       "dis", "mis", "out"]
SUF = ["ly", "ness", "ity", "er", "or", "ist", "ism", "ation", "ification", "ment",
       "able", "ible", "ful", "less", "ish", "ing", "ed", "al", "ic", "ive", "ise",
       "ize", "ify", "dom", "hood", "ship"]

RULE_KINDS = {"affix_strip", "compound_split", "grammatical_derivation",
              "meaning_shift_derivation", "lexicalised_participle"}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_digest(obj):
    """Stable digest of a JSON-serialisable object, used as the input digest."""
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def recover_affix(word, root):
    """Which affix, on which end, turns `root` into `word`.

    Mirrors build_pool.affix_root's candidate forms, including the -y/-i
    spelling change that lets `naughtiness` reach `naughty`.
    """
    for p in PRE:
        if word.startswith(p) and word[len(p):] == root:
            return {"affix": p, "position": "prefix", "spelling_change": None}
    for s in SUF:
        if not word.endswith(s):
            continue
        stem = word[:-len(s)]
        if stem == root:
            return {"affix": s, "position": "suffix", "spelling_change": None}
        if stem + "e" == root:
            return {"affix": s, "position": "suffix", "spelling_change": "root drops final -e"}
        if len(stem) > 1 and stem[:-1] + "y" == root:
            return {"affix": s, "position": "suffix", "spelling_change": "root final -y becomes -i"}
    return None


# Negative prefixes that sit outside the participle: `unflustered` is
# un- + (fluster + -ed), so the verb to look for is `fluster`, not `unfluster`.
NEGATIVE_PREFIXES = ("un", "in", "im", "ir", "il", "non", "dis", "mis")


def base_verb(en, lemma):
    """Every plausible base verb for a participial adjective, widest net first.

    This deliberately does NOT try to prove the root is real, because OEWN gives
    it nothing to prove it with: participial adjectives carry no derivation link
    back to their base verb. `convoluted` has relations, none of them to
    `convolute`; `exacting` has two, neither to `exact`. Checked, not assumed.

    So the net is cast wide and the judge does the validating. That is the whole
    point of the gate: a proposed decomposition that turns out to be a string
    coincidence comes back `unsupported`, exactly as `rebut` <- `but` did. A
    false candidate costs one cheap adjudication; a missed root costs a word
    that was never judged at all.

    build_pool._base_verb tried stripping two or three characters and never one,
    which is why `convoluted` was recorded as rootless even though `convolute`
    is right there. Measured over the delivery band, this recovers a root for
    923 of the 1,091 participles the pool left rootless.
    """
    stem = lemma[:-3] if lemma.endswith("ing") else lemma[:-2]
    candidates = [
        stem,                # convoluted  -> convolut(e) handled below
        stem + "e",          # convoluted  -> convolute
        lemma[:-1],          # convoluted  -> convolute
        lemma[:-2],          # inspiriting -> inspirit
        lemma[:-3],
        lemma[:-3] + "e",
        lemma[:-2] + "e",
    ]
    # A doubled final consonant in the stem is usually the participle's, not the
    # verb's: nonplussed -> nonplus, not nonpluss.
    if len(stem) > 2 and stem[-1] == stem[-2]:
        candidates.append(stem[:-1])

    def is_verb(form):
        return bool(form) and any(w.pos == "v" for w in en.words(form))

    for candidate in candidates:
        if is_verb(candidate):
            return candidate
    # Retry outside a negative prefix, which the participle rule cannot see past.
    for prefix in NEGATIVE_PREFIXES:
        if not lemma.startswith(prefix):
            continue
        for candidate in candidates:
            if candidate.startswith(prefix) and is_verb(candidate[len(prefix):]):
                return candidate[len(prefix):]
    return None


def source_meanings(en, display):
    """Every OEWN sense of a form, with the stable identifier the judge must cite."""
    out = []
    for word in en.words(display):
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
    out.sort(key=lambda m: m["sense_id"])
    return out


def frequency(row):
    return None if row is None else row["zipf_summed"]


def build_component(en, con, normalized, role, missing, path):
    """Evidence for one root or compound part, marking whatever cannot be found."""
    row = con.execute("SELECT * FROM lemma WHERE lemma = ?", (normalized,)).fetchone()
    display = row["display"] if row else normalized
    meanings = source_meanings(en, display)
    if not meanings:
        # Case-folded retry: the pool keys on the lowercase form, OEWN on display.
        meanings = source_meanings(en, normalized)
    if not meanings:
        missing.append(f"{path}.source_meanings")
    zipf = frequency(row)
    if zipf is None:
        missing.append(f"{path}.zipf")
    return {
        "role": role,
        "normalized": normalized,
        "display": display,
        "in_candidate_pool": row is not None,
        "zipf": zipf,
        "source_meanings": meanings,
    }


def build_claim(en, con, case):
    lemma, rule_kind = case["lemma"], case["rule_kind"]
    if rule_kind not in RULE_KINDS:
        sys.exit(f"unknown rule_kind {rule_kind!r} for {lemma!r}")

    row = con.execute("SELECT * FROM lemma WHERE lemma = ?", (lemma,)).fetchone()
    if row is None:
        sys.exit(f"{lemma!r} is not in the candidate pool")

    missing = []
    components = []
    decomposition = {"kind": rule_kind}

    if rule_kind == "affix_strip":
        root = row["transparent_root"] or row["derived_root"]
        if not root:
            missing.append("claim.decomposition.root")
        else:
            affix = recover_affix(lemma, root)
            if affix is None:
                sys.exit(f"cannot recover the affix that turns {root!r} into {lemma!r}")
            decomposition.update({"whole": lemma, "root": root, **affix})
            components.append(build_component(en, con, root, "root", missing, "claim.root"))

    elif rule_kind == "meaning_shift_derivation":
        root = row["transparent_root"] or row["derived_root"]
        if not root:
            missing.append("claim.decomposition.root")
        else:
            affix = recover_affix(lemma, root)
            decomposition.update({"whole": lemma, "root": root,
                                  **(affix or {"affix": None, "position": None,
                                               "spelling_change": None})})
            if affix is None:
                missing.append("claim.decomposition.affix")
            components.append(build_component(en, con, root, "root", missing, "claim.root"))

    elif rule_kind == "grammatical_derivation":
        root = row["derived_root"]
        if not root:
            missing.append("claim.decomposition.root")
        else:
            affix = recover_affix(lemma, root)
            decomposition.update({"whole": lemma, "root": root,
                                  **(affix or {"affix": None, "position": None,
                                               "spelling_change": None})})
            if affix is None:
                # An OEWN derivation link with no affix this rule set can name.
                missing.append("claim.decomposition.affix")
            components.append(build_component(en, con, root, "root", missing, "claim.root"))

    elif rule_kind == "compound_split":
        parts = (row["compound_parts"] or "").split("+")
        if len(parts) != 2 or not all(parts):
            sys.exit(f"{lemma!r} has no usable compound_parts")
        decomposition.update({"whole": lemma, "parts": parts})
        for i, part in enumerate(parts):
            components.append(
                build_component(en, con, part, f"part_{i + 1}", missing, f"claim.part_{i + 1}"))

    elif rule_kind == "lexicalised_participle":
        root = base_verb(en, lemma)
        suffix = "ed" if lemma.endswith("ed") else "ing"
        decomposition.update({"whole": lemma, "root": root, "affix": suffix,
                              "position": "suffix", "spelling_change": None,
                              "root_stored_by_rule": bool(row["transparent_root"]
                                                          or row["derived_root"])})
        if root is None:
            missing.append("claim.decomposition.root")
        else:
            components.append(build_component(en, con, root, "root", missing, "claim.root"))

    # A rule that proposed no root made no claim. There is nothing for the judge
    # to support or refute, and asking costs money to be told so. These are
    # recorded and advanced deterministically rather than dropped, because spike
    # #44's rule holds here too: a filter is a column, never a deletion.
    needs_root = rule_kind != "compound_split"
    if needs_root and not decomposition.get("root"):
        return {
            "claim_id": f"{lemma}|{rule_kind}",
            "extraction_version": EXTRACTION_VERSION,
            "candidate": {"normalized": lemma, "display": row["display"],
                          "zipf": row["zipf_summed"]},
            "rule_kind": rule_kind,
            "filtered": "no_root_proposed",
            "reason": ("the rule flagged this word but proposed no root, so it made no "
                       "claim to adjudicate"),
            "disposition": "advance",
            "policy_context": {"endorsements": row["endorsements"]},
        }

    candidate_meanings = source_meanings(en, row["display"])
    if not candidate_meanings:
        missing.append("candidate.source_meanings")

    claim_id = f"{lemma}|{rule_kind}"
    claim = {
        "claim_id": claim_id,
        "extraction_version": EXTRACTION_VERSION,
        "candidate": {
            "normalized": lemma,
            "display": row["display"],
            "pos": (row["pos"] or "").split(",") if row["pos"] else [],
            "zipf": row["zipf_summed"],
            "source_meanings": candidate_meanings,
        },
        "claim": {
            "rule_kind": rule_kind,
            "decomposition": decomposition,
            "components": components,
        },
        "missing_evidence": sorted(set(missing)),
    }
    # Endorsement is deliberately outside `claim`: it never reaches the prompt.
    # It rides along as a policy input and as the external retention audit.
    claim["policy_context"] = {"endorsements": row["endorsements"]}
    claim["input_digest"] = canonical_digest(
        {k: claim[k] for k in ("claim_id", "extraction_version", "candidate", "claim",
                               "missing_evidence")})
    return claim


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", required=True, type=pathlib.Path)
    ap.add_argument("--out", required=True, type=pathlib.Path)
    ap.add_argument("--pool", default=pathlib.Path("out/pool.sqlite"), type=pathlib.Path)
    ap.add_argument("--rules", default=pathlib.Path("build_pool.py"), type=pathlib.Path)
    ap.add_argument("--wn-data", default=pathlib.Path("data/wn"), type=pathlib.Path)
    args = ap.parse_args()

    if not args.pool.exists():
        # The committed copy, for anyone who has not rebuilt the pool.
        fallback = pathlib.Path("pool.sqlite")
        if not fallback.exists():
            sys.exit(f"no pool database at {args.pool} or {fallback}")
        args.pool = fallback

    wn.config.data_directory = args.wn_data.resolve()
    en = wn.Wordnet("oewn:2025")

    con = sqlite3.connect(args.pool)
    con.row_factory = sqlite3.Row

    spec = json.loads(args.cases.read_text())
    built = [build_claim(en, con, case) for case in spec["claims"]]
    claims = sorted((c for c in built if "filtered" not in c), key=lambda c: c["claim_id"])
    filtered = sorted((c for c in built if "filtered" in c), key=lambda c: c["claim_id"])

    args.out.mkdir(parents=True, exist_ok=True)

    def write(path, rows):
        with path.open("w") as fh:
            for row in rows:
                fh.write(json.dumps(row, sort_keys=True, separators=(",", ":"),
                                    ensure_ascii=False) + "\n")

    jsonl = args.out / f"{spec['case_set']}.claims.jsonl"
    write(jsonl, claims)
    write(args.out / f"{spec['case_set']}.filtered.jsonl", filtered)

    manifest = {
        "case_set": spec["case_set"],
        "extraction_version": EXTRACTION_VERSION,
        "max_examples": MAX_EXAMPLES,
        "claim_count": len(claims),
        "filtered_count": len(filtered),
        "sources": {
            "oewn": {"release": "oewn:2025", "retrieved_via": f"wn {wn.__version__}"},
            "wordfreq": {"version": "3.1.1", "wordlist": "large"},
            "candidate_pool": {"path": str(args.pool), "sha256": sha256_file(args.pool)},
        },
        "deterministic_rules": {
            "source": str(args.rules),
            "sha256": sha256_file(args.rules) if args.rules.exists() else None,
        },
        "claims": {c["claim_id"]: c["input_digest"] for c in claims},
    }
    (args.out / f"{spec['case_set']}.manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n")

    for claim in claims:
        marks = ", ".join(claim["missing_evidence"]) or "none"
        print(f"{claim['claim_id']:38} meanings={len(claim['candidate']['source_meanings'])} "
              f"components={len(claim['claim']['components'])} missing=[{marks}]")
    for claim in filtered:
        print(f"{claim['claim_id']:38} FILTERED {claim['filtered']} -> {claim['disposition']}")
    print(f"\nwrote {len(claims)} claims and {len(filtered)} filtered to {args.out}")


if __name__ == "__main__":
    main()
