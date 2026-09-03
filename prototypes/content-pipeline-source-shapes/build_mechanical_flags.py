"""Mechanical pool flags: demonyms, eponym-only glosses, display-form shifts,
and grammatical lemma redundancy.

Standalone by design. This does NOT touch `export_evidence.py`, because bumping
`intake-evidence/*` would change every `input_digest` and invalidate the frozen
calibration partitions, their labels, and every persisted run fingerprint. It
reads the pool and OEWN and writes its own artefact; fold it into the exporter
whenever the evidence version next bumps for another reason.

Four flags, and they are deliberately not equally trusted:

  demonym            structural, safe to act on. Walks OEWN's hypernym chain to
                     `inhabitant` / `native` / `denizen`. Applied per SENSE, not
                     per word, because `spartan` and `philistine` each carry a
                     resident sense alongside the senses worth teaching.

  eponym_gloss_only  a marker, never acted on. Every sense is either a demonym
                     noun or an "of or relating to <Proper Noun>" adjective. That
                     is true both of words genuinely not worth teaching (Texan)
                     and of words whose useful sense OEWN simply lacks
                     (draconian, machiavellian, orwellian). Nothing in OEWN can
                     tell those apart, so this records the ambiguity rather than
                     resolving it. If good words later go missing, this is the
                     bucket to look in.

  display_shift      a review candidate, not an auto-apply. Nouns whose dominant
                     surface form is the plural and whose singular is genuinely
                     rare: `shenanigan` -> `shenanigans`. Roughly a third of the
                     candidates are proper-noun contamination in the frequency
                     data (`wale`/Wales, `oiler`/Oilers, `tetri`/Tetris), which
                     the available evidence cannot detect.

  lemma_redundant    a safe deferral for direct grammatical derivatives whose
                     standalone root is also in the pool. Meaning-bearing
                     derivations and derivatives of derived roots remain.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path

import wn

PEOPLE_ROOTS = {"inhabitant", "native", "denizen"}
RELATIONAL_GLOSS = re.compile(
    r"^(of or |of, |relating to|pertaining to|characteristic of|of [A-Z])"
)
PROPER_NOUN = re.compile(r"\b[A-Z][a-z]{2,}")

# Below this Zipf the singular is not a form people actually write, which is what
# makes the plural the real lexical unit rather than merely the commoner one.
RARE_SINGULAR_ZIPF = 2.0
DOMINANT_SHARE_MIN = 0.90
GRAMMATICAL_SUFFIXES = ("ness", "ity", "ly")
MEANING_BEARING_SUFFIXES = ("ist", "ism", "ish", "ful")


def walks_to_people(synset, depth: int = 12) -> bool:
    """Does this sense's `is-a` chain reach inhabitant / native / denizen?"""
    current = synset
    for _ in range(depth):
        lemmas = current.lemmas()
        if lemmas and lemmas[0] in PEOPLE_ROOTS:
            return True
        hypernyms = current.hypernyms()
        if not hypernyms:
            return False
        current = hypernyms[0]
    return False


def is_place_adjective(synset) -> bool:
    """An adjective glossed only as relating to some proper noun."""
    if synset.pos not in ("a", "s"):
        return False
    definition = synset.definition() or ""
    return bool(RELATIONAL_GLOSS.match(definition)) and bool(PROPER_NOUN.search(definition))


def classify_senses(word: str, lexicon) -> list[dict]:
    senses = []
    for entry in lexicon.words(word):
        for synset in entry.synsets():
            if synset.pos == "n" and walks_to_people(synset):
                verdict = "demonym_noun"
            elif is_place_adjective(synset):
                verdict = "place_adjective"
            else:
                verdict = "keep"
            senses.append(
                {
                    "pos": synset.pos,
                    "definition": (synset.definition() or "")[:120],
                    "verdict": verdict,
                }
            )
    return senses


def display_shift(row: sqlite3.Row) -> dict | None:
    """A noun whose plural is the form people actually use."""
    lemma, dominant = row["lemma"], row["dominant_form"]
    if not dominant or dominant == lemma:
        return None
    if not (row["pos"] or "").count("n"):
        return None
    if dominant not in (f"{lemma}s", f"{lemma}es"):
        return None
    share, own = row["dominant_share"], row["zipf_own"]
    if share is None or share < DOMINANT_SHARE_MIN:
        return None
    if own is None or own >= RARE_SINGULAR_ZIPF:
        return None
    return {
        "serve": dominant,
        "instead_of": lemma,
        "dominant_share": round(share, 3),
        "zipf_singular": own,
        "zipf_paradigm": row["zipf_summed"],
    }


def lemma_redundancy(row: dict, pool: dict[str, dict]) -> dict | None:
    """Prefer a direct grammatical derivative's standalone root.

    A root that is itself derived is not a safe deferral target: `fruitful` is
    already a meaning-bearing step away from `fruit`, so `fruitfulness` is not
    redundant with the root lemma.
    """
    if not row["f_derived"] or not row["derived_root"]:
        return None
    suffix = next(
        (suffix for suffix in GRAMMATICAL_SUFFIXES if row["lemma"].endswith(suffix)),
        None,
    )
    if suffix is None:
        return None
    if suffix in ("ness", "ity") and row["pos"] != "n":
        return None
    if suffix == "ly" and row["pos"] != "r":
        return None

    root = pool.get(row["derived_root"])
    if root is None:
        return None
    if root["f_transparent"] or root["f_derived"] or root["f_derived_soft"]:
        return None
    if root["lemma"].endswith(MEANING_BEARING_SUFFIXES):
        return None
    return {"prefer": root["lemma"], "reason": "grammatical_derivation"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pool", type=Path, default=Path("pool.sqlite"))
    parser.add_argument("--wn-data", type=Path, default=Path("data/wn"))
    parser.add_argument("--out", type=Path, default=Path("mechanical-flags.jsonl"))
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    wn.config.data_directory = args.wn_data.resolve()
    lexicon = wn.Wordnet("oewn:2025")

    connection = sqlite3.connect(f"file:{args.pool}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    query = (
        "SELECT lemma, display, pos, zipf_own, zipf_summed, dominant_form, "
        "dominant_share, oewn_senses, endorsements, f_transparent, f_derived, "
        "f_derived_soft, derived_root FROM lemma ORDER BY lemma"
    )

    counts = {
        "demonym": 0,
        "eponym_gloss_only": 0,
        "display_shift": 0,
        "lemma_redundant": 0,
        "rows": 0,
    }
    pool_rows = list(connection.execute(query))
    rows = pool_rows[: args.limit] if args.limit else pool_rows
    pool = {row["lemma"]: dict(row) for row in pool_rows}
    with args.out.open("w") as handle:
        for row in rows:
            counts["rows"] += 1
            senses = classify_senses(row["lemma"], lexicon)
            flags: dict[str, object] = {}

            if senses:
                kept = [s for s in senses if s["verdict"] == "keep"]
                if not kept:
                    # Every sense is a place or a resident of one.
                    if any(s["verdict"] == "demonym_noun" for s in senses):
                        flags["demonym"] = True
                        counts["demonym"] += 1
                    flags["eponym_gloss_only"] = True
                    counts["eponym_gloss_only"] += 1
                elif len(kept) < len(senses):
                    # Partly a demonym: keep the word, serve only what survived.
                    flags["senses_dropped"] = len(senses) - len(kept)

            shift = display_shift(row)
            if shift:
                flags["display_shift"] = shift
                counts["display_shift"] += 1

            redundancy = lemma_redundancy(row, pool)
            if redundancy:
                flags["lemma_redundant"] = redundancy
                counts["lemma_redundant"] += 1

            if not flags:
                continue
            handle.write(
                json.dumps(
                    {
                        "lemma": row["lemma"],
                        "zipf_summed": row["zipf_summed"],
                        "endorsements": row["endorsements"],
                        "flags": flags,
                        "senses": senses,
                    }
                )
                + "\n"
            )

    print(f"scanned {counts['rows']} lemmas -> {args.out}")
    print(f"  demonym (safe to act on)      : {counts['demonym']}")
    print(f"  eponym_gloss_only (marker)    : {counts['eponym_gloss_only']}")
    print(f"  display_shift (needs review)  : {counts['display_shift']}")
    print(f"  lemma_redundant (safe defer)   : {counts['lemma_redundant']}")


if __name__ == "__main__":
    main()
