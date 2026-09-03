"""PROTOTYPE (issue #56) — the deterministic filters that run before the judge.

One definition, imported by every sampler and by any production run, so the
question "what reaches the gate" has exactly one answer. A rule copied into two
callers is a rule that will disagree with itself.

These run FIRST, and everything here is a claim code can settle without a model.
Nothing fuzzy belongs in this file: a mechanical rule that guesses is how #49
ended up excluding words nobody could defend, and stage 1's finding — that a
rule's *shape* can be wrong rather than just its search — applies to every line
below.

  zipf ceiling         Too common to teach. Measured, not guessed: `happy` sits
                       at 5.38 against a golden-keep range of 2.12-3.43. Set at
                       4.0 rather than lower because the judge is expected to
                       catch the everyday words inside the band on their meaning
                       — `chanted` at 3.0 and `pout` at 3.1 are in-band and still
                       obviously ordinary. A high ceiling means more chances for
                       the judge to be wrong, which is also more chances to find
                       out where it is wrong.

  zipf floor           Below this the form is not one people write. It is the
                       pool's own floor, kept explicit so a later change is a
                       decision rather than a side effect.

  f_roman              Roman numerals. `xxi` cost a model call in draw 1.
  f_variant            Non-preferred spelling variants; the preferred form is
                       already in the pool under its own row.
  f_british            British-only spellings — `vapour`, `utilised`,
                       `internationalise`. Same word, wrong surface form.

NOT here, deliberately:

  f_compound (9.3%)    `afterimage` is a compound worth teaching. This is what
  f_transparent (16%)  morphology was demoted for: these are attributes that
  f_abstract (70%)     inform a judgment, never a judgment. Anything filtering a
  f_derived_soft (19%) tenth of the band on a string heuristic is the mistake
  f_no_synonyms (31%)  #49 already made.

  f_informal           Headword-scoped register, the same defect measured on
                       `wik_labels`: it would drop `pernicious` and `laconic`.
                       Register belongs to #57, sense-scoped.

  demonym              Real, and already built in build_mechanical_flags.py, but
                       it needs OEWN rather than the pool alone. Applied as a
                       separate pass over that artefact.
"""

ZIPF_CEILING = 4.0
ZIPF_FLOOR = 1.0

FILTER_VERSION = "intake-filters/1"

# Pool columns that mean "a different row already carries this word properly".
BLOCKING_COLUMNS = ("f_roman", "f_variant", "f_british")

WHERE = (
    f"zipf_summed >= {ZIPF_FLOOR} AND zipf_summed < {ZIPF_CEILING} "
    "AND oewn_senses > 0 "
    + "".join(f"AND NOT {column} " for column in BLOCKING_COLUMNS)
).strip()


def reasons(row):
    """Every filter a row trips, for reporting. Empty means it reaches the judge."""
    tripped = []
    zipf = row["zipf_summed"]
    if zipf is None:
        tripped.append("no_frequency")
    else:
        if zipf >= ZIPF_CEILING:
            tripped.append("too_common")
        if zipf < ZIPF_FLOOR:
            tripped.append("below_floor")
    if not row["oewn_senses"]:
        tripped.append("no_senses")
    for column in BLOCKING_COLUMNS:
        if row[column]:
            tripped.append(column)
    return tripped


def passes(row):
    return not reasons(row)
