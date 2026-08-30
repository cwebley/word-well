# Intake adjudication stage 3: the usefulness gate's baseline

## Pre-run record

**Issue.** [#56](https://github.com/cwebley/word-well/issues/56)

**Question.** With a prompt of one sentence of criterion, and evidence limited to
glosses and frequency, which of the six obvious rejects does the audience-
usefulness gate let through, and does the per-meaning contract hold?

**Hypothesis.** The contract holds on all nineteen meanings — it is a smaller
contract than morphology's, on a path stage 1 and stage 2 both validated. The six
keeps pass. Two to four of the six rejects fail, most likely `homegirl` and
`herbivorous`, which the working-decisions comment predicted by name. A thin
prompt has nothing in it that would reject a word for register or for being an
encyclopedic fact.

**Changed variable.** None, in the sense that matters: this is a new gate's first
run and therefore its own baseline. Everything about it is new — contract,
rubric, prompt, policy, evidence shape and unit of judgment. Nothing here is
comparable to stage 2, and the model differs from stage 2's as well (below), so
no number in this record should be read against `morphology-rubric/2`'s.

**Unit of judgment.** One **source meaning**, not a headword. Stage 2 finding 2
measured what grouping costs: three of its four errors sat inside multi-sense
groups sharing one rationale that was true only of the easiest member. Working
decision 4 settles it — fan out from the start rather than re-run that
experiment. Nineteen meanings across twelve headwords, each its own paid call
with its own fingerprint. `deriveHeadwordDisposition` folds them afterwards.

**Evidence.** Per meaning: definition, examples, synset members, part of speech.
Per headword: display form, recorded parts of speech, Zipf with its scale stated.
Nothing else — specifically no Wiktionary register labels and no mechanical
flags. That was the one open design call in the handoff, and it was settled by
measurement rather than preference:

| Evidence | Effect on the golden twelve |
|---|---|
| Frequency | Load-bearing. `happy` sits at Zipf 5.38 against 2.12–3.43 for the rest, and is the only signal that rejects it |
| `wik_labels` | Catches 2 of 6 rejects (`dimwit`, `pinnate`), misses 4 — `homegirl` and `happy` carry no labels at all |
| `wik_labels` | **Misinforms on two keeps.** `pernicious` is tagged `obsolete`, `laconic` is tagged `Australia,proscribed`. The labels are headword-scoped; the register belongs to one sense |
| Mechanical flags | The deterministic filters run *before* this gate, so feeding them in tells the judge an answer it is not being asked for |

The same shape defect rules out the obvious mechanical shortcut of rejecting
`dimwit` on a `derogatory` label: 301 pool words carry one, 18 of them
editorially endorsed, including `mundane` at eight endorsements — the same count
as `ubiquitous`, `laconic` and `austere`. That is carried finding 5 exactly, a
rule misfiring in its shape rather than its search. If register earns its way in
later it must be sense-scoped first, and it belongs to #57.

**Dataset.** `usefulness-golden/1`, twelve headwords, nineteen meanings. Six
clear keeps and six clear rejects spanning six distinct reject reasons. The
labels are categorical buckets per headword — `serve` / `reject` / `borderline`,
mapping to `advance` / `exclude` / `quarantine` — not a verdict per source
meaning, which is where #49's retracted labels came from. There is no capability
partition and no hidden holdout: capability cases get added from observed
failures, not enumerated up front.

**Model.** `deepseek/deepseek-v4-flash-0731` through the pinned `morph/bf16`
endpoint, temperature 0. This is the configuration already pinned in
`.env.local`, and a `bf16` endpoint as the handoff prefers. Note stage 2 ran on
`google/gemini-2.5-flash` via `google-ai-studio`; both models have a validated
contract path behind them — stage 1 used this one — but a cross-stage comparison
of scores would be measuring the model change as much as anything else.

**Case limit.** Exactly nineteen calls, once each. Persisted records may be
reused only for an unchanged config fingerprint.

**Expected spend.** `$0.0183` pessimistic estimate with the 2x margin. Stage 2
measured the estimator at **6.0x** the actual, so the realistic figure is nearer
`$0.003`. The ledger read `$0.085033` before the run, of which `$0.0039` is the
39 fabricated entries from the since-fixed test leak: true spend `$0.0811`, and
`$9.9150` remaining against the estimate.

**Stopping condition.** Stop after nineteen attempted meanings. Do not repair or
retry contract-invalid output; transport retries remain enabled. Do not iterate
the prompt in the same session as the baseline — a v2 written before the user has
seen v1's failures is exactly the guessing the start-thin decision rules out.
Stop at the human checkpoint #56 requires.

**What would make this run uninformative.** A perfect score. Twelve cases
labelled by one person, six of which are trip-wires that must never break, cannot
support an accuracy claim; if the gate passes all twelve the useful output is the
retention audit and the next set of capability cases, not the number.
