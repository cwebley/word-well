# Practice leaves the vocabulary record, and register leaves the lesson

The automated lesson planner and writer spike produces lessons the production
`VocabularyDraft` cannot hold, so the production shape changes rather than the
lessons. Practice items move out of `VocabularyDraft` into their own record
bound to a published meaning; `register` is removed; `synonyms` becomes a
synonym contrast carrying what the synonym has more and less of than the
headword; and `meaning_id`, `common_patterns`, `usage_notes` and `word_family`
enter the shape.

## Why Practice moves out

`VocabularyDraft` nests `practice` inside every meaning and
`validateRequiredContent` quarantines a draft where any of its four fields is
empty. A lesson therefore cannot exist without a Practice item, and replacing an
item means redrafting the meaning that holds it.

`CONTEXT.md` has said the opposite since it was written: Practice items are
"generated, evaluated, published, and withdrawn independently of the lesson
body, so a bank can be replenished without redrafting the lesson." Nobody
noticed the contradiction because the #66 pilot generated the lesson and its
Practice in a single model call, so the two could not come apart.

The spike separated them, and the contradiction became load-bearing. The
planner-and-writer split is adopted; Practice generation is not, because the
forced malaprop does not reach usable reliability. Under the current type, that
combination cannot publish anything at all: a good lesson is quarantined for
missing a Practice item we have deliberately decided not to generate yet.

The shapes also disagree. Production holds one `incorrectSentence` and a
`prompt`. The spike produces two typed distractors — an opposite and a
malaprop, each with its own intended error, the malaprop also naming the word it
replaced — and no prompt at all. Waiting for Practice to be adopted would not
have resolved this.

**A Practice item is bound to its published meaning, not to the lesson body's
wording.** It stays valid while that meaning's definition and part of speech are
unchanged; changing either withdraws the items written against it. Editing an
example, a usage note or a synonym contrast leaves the bank intact. Binding to
the whole lesson's content version was the alternative, and it is what the
prototype does today — the Practice request key includes the lesson content
digest, so re-running the writer during the second spike run orphaned every
Practice artifact for all three headwords. That is a safe rule and a wasteful
one: a typo fix in one example discards a word's entire Practice bank.

`meaning_id` enters the shape to make that binding expressible. Production
meanings are currently identified by array position, which cannot survive
reordering and cannot be referenced from a separate record.

## Why register goes

The spike removed register from the learner-facing lesson and kept source labels
in evidence. `CONTEXT.md` never made register learner-facing: it appears only as
a factual intake filter and as one input to `Word difficulty`. Production
nonetheless requires a non-empty `register` string and a `registerEvidenceId` on
every meaning, so a headword whose sources carry no register label can only be
published by inventing one — and inventing a generic `neutral` is exactly what
the spike set out to stop.

Register stays in evidence and in intake. It leaves the published record.

## Why synonyms gain two sides

`synonyms: readonly string[]` holds names and nothing else, so projecting the
spike's output into it discards the comparison a learner needs:

```
unbiased      + objectivity   − favoritism
unprejudiced  + fairness      − preconception
```

The published shape carries the contrast, and provenance moves with it. Today
`PublishedMeaning.provenance.synonyms` is one `GeneratedFieldProvenance` for the
whole list; the spike records evidence per contrast, which is finer than the
production type can express.

## Consequences

- `EvaluationMeaningAssertion` asserts on `register` and `practice`, so every
  evaluation case changes shape.
- Two of the eight entries in `requiredEvaluationCoverage` are named for what is
  moving: `frequency-and-register` and `adversarial-practice`. A third,
  `morphology`, is already stale — morphology was retired from the pipeline on
  2026-09-05 — and should be settled at the same time rather than left as the
  only untouched anomaly in an otherwise revised list.
- Publishing a lesson with no Practice items becomes legal. Whatever serves
  Practice to learners has to tolerate an empty bank, which it must do anyway
  once items can be withdrawn independently.
- The rule for withdrawing Practice items needs the meaning's definition and
  part of speech to be comparable across drafts, which is a further reason
  `meaning_id` cannot be positional.

## Not decided here

Whether the shape is right in practice. The spike carries a projection from its
assembled lesson into these types so the mapping runs against real `candid`,
`defenestrate` and `austere` output before `src/content-pipeline.ts` changes.
