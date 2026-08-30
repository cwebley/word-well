# Intake adjudication stage 2: prompt smoke test

## Pre-run record

**Issue.** [#49](https://github.com/cwebley/word-well/issues/49)

**Question.** Does the fixed morphology evidence and version 2 rubric produce
contract-valid, reviewable judgments on twelve difficult human-labelled claims
when used with one midrange model?

**Hypothesis.** Gemini 2.5 Flash will satisfy the strict contract on all twelve
claims and will expose any obvious prompt or evidence-shape failures before a
multi-model benchmark.

**Changed variable.** None. This is the baseline run for
`morphology-rubric/2`. Version 2 asks predictability as a literal yes/no question
even when analysis support is `unsupported`; it reserves
`insufficient_evidence` for missing or incomplete evidence.

**Dataset.** `morphology-calibration/2`, twelve human-reviewed development
claims. The original 200-case and later 50-case plans were abandoned because the
manual review burden was too high. This set has no regression or hidden holdout,
so it supports a prompt smoke test but no held-out accuracy claim.

| Claim | Rule kind | Why included |
|---|---|---|
| `rebut` | affix strip | Known bogus analysis |
| `fruitfulness` | affix strip | Polysemous, mixed predictability |
| `pastoral` | compound split | Known bogus analysis, endorsed |
| `nighthawk` | compound split | Polysemous literal and person meanings |
| `handspring` | compound split | Specific action from ordinary components |
| `sheepskin` | compound split | Literal material and shifted meanings |
| `sameness` | grammatical derivation | Multiple abstract meanings |
| `tightness` | grammatical derivation | Five meanings across categories |
| `mercurial` | meaning-shift derivation | Literal, divine, planetary, and figurative meanings |
| `ringer` | meaning-shift derivation | Four meanings with mixed predictability |
| `convoluted` | lexicalised participle | Literal and figurative meanings |
| `nonplussed` | lexicalised participle | Missing root frequency and endorsement override |

**Model.** `google/gemini-2.5-flash` through the pinned
`google-ai-studio` endpoint. OpenRouter reported `$0.300/M` prompt tokens and
`$2.500/M` completion tokens immediately before the run. Endpoint quantization
was not reported by OpenRouter.

**Case limit.** Exactly twelve calls, once each. Persisted records may be reused
only for an unchanged config fingerprint.

**Expected spend.** `$0.1071` pessimistic estimate with the existing 2x safety
margin. The spend ledger recorded `$0.0666` spent and `$9.9334` remaining before
the run.

**Stopping condition.** Stop after twelve attempted claims. Do not repair or
retry contract-invalid output. Transport retries remain enabled. Do not begin
the three-model benchmark before the user reviews the results.

## Results

Twelve claims, twelve calls, no repairs and no transport retries. Every record
persisted, and the run reconciles exactly against the ledger: twelve entries,
`$0.017812`, matching the sum of `usage.cost_usd` across the twelve records to
the cent.

### The path holds

All six contract scorers returned `1.00` on all twelve claims. The provider
honoured the strict schema every time, every answer came back attached to the
claim it was asked about, every candidate source meaning was judged exactly
once, and no cited identifier was invented. `ContractNoInventedDisposition`
found nothing, which is the alarm staying silent rather than a result.

`nonplussed` exercised the endorsement override end to end: morphology derived
`exclude`, six endorsements carried it to `advance`, and the label agreed. The
override fired where it was supposed to and nowhere else — one of twelve.

### Scores

| Scorer | Mean | n | Perfect |
|---|---|---|---|
| ContractSchemaValid | 1.0000 | 12 | 12/12 |
| ContractEnumsAllowed | 1.0000 | 12 | 12/12 |
| ContractClaimIdentity | 1.0000 | 12 | 12/12 |
| ContractMeaningAccounting | 1.0000 | 12 | 12/12 |
| ContractEvidenceExists | 1.0000 | 12 | 12/12 |
| ContractNoInventedDisposition | 1.0000 | 12 | 12/12 |
| AnalysisSupport | 1.0000 | 12 | 12/12 |
| MeaningPredictability | 0.8417 | 10 | 6/10 |
| MorphologyDisposition | 0.8333 | 12 | 10/12 |
| EffectiveDisposition | 0.8333 | 12 | 10/12 |

`AnalysisSupport` was perfect, including both claims where the mechanical rule
had invented the decomposition: the judge called `rebut` and `pastoral`
`unsupported` and said why. Deciding *whether the word is built the way the rule
claims* looks solid. Every error was in the second question — *does this meaning
follow from the parts*.

### Finding 1: the judge over-calls `predictable`, and never the reverse

Four disagreements across 27 judged meanings. All four are the same error in the
same direction: the model said `predictable` where the label says
`not_predictable`. There is not one error the other way.

| Claim | Disputed meaning | Model said |
|---|---|---|
| `fruitfulness` | the intellectual productivity of a creative imagination | predictable |
| `nighthawk` | a person who likes to be active late at night | predictable |
| `mercurial` | characteristics (eloquence, shrewdness, thievishness) attributed to the god | predictable |
| `sheepskin` | skin of a sheep or goat prepared for writing on | predictable |

The rationales show the mechanism. The judge reasons *backward* from a meaning
it already knows to a derivation path that could plausibly reach it, rather than
*forward* from the supplied parts to the meaning. On `nighthawk` it wrote: "a
predictable figurative extension, comparing a person's nocturnal habits to those
of a `nighthawk` bird" — which reaches the person sense from the candidate's own
other sense, not from `night` + `hawk` at all. That is circular, and the rubric
does not currently forbid it.

This is the same distinction that makes `afterimage` worth keeping: a meaning
you can explain after the fact is not a meaning a learner could have arrived at.
The rubric asks the forward question and the judge is answering the backward
one.

### Finding 2: grouped meanings are where the errors hide

The contract lets a finding group several sense identifiers under one verdict
and one rationale. Three of the four errors sit inside such a group.

- Senses judged inside a multi-sense group: 12, with 3 errors (25%).
- Senses judged alone: 15, with 1 error (7%).

n is far too small for that gap to carry weight on its own. The mechanism is the
stronger evidence: in each of the three, the model wrote a single rationale that
is true of the group's easy member and then asserted it over the hard one. On
`sheepskin` it grouped "tanned skin with the fleece left on" with "skin prepared
for writing on" and justified both with "these meanings directly refer to the
skin of a sheep" — true of the first, and precisely the step that loses the
second. On `mercurial` it grouped the metal, the god and the planet under "these
meanings directly relate to the element mercury, the god Mercury, or the planet
Mercury", which asserts the conclusion for all three by listing them.

This bears directly on stage 1's open finding 3, one call per meaning. That was
framed as a cost/accuracy trade to be measured rather than argued. This run is
the first evidence on it, and it points one way: the group is the vehicle of the
error.

### Finding 3: the policy converts this bias into silent exclusions

`morphology-policy/2` advances a word when *any* meaning is `not_predictable`,
and excludes only when the analysis is supported and *every* meaning is
predictable. A judge biased toward `predictable` therefore fails in exactly one
direction — toward `exclude`.

Two of twelve were wrongly excluded. `fruitfulness` and `nighthawk` both carry
zero endorsements, so nothing could rescue them; both are words the labels say
should advance.

`mercurial` and `sheepskin` carried the same error and survived anyway, because
each had *another* meaning the judge correctly called `not_predictable`. They
were protected by polysemy, not by accuracy. A word with one wrongly-judged
meaning and no second interesting sense has no such protection.

The asymmetry matters more than the rate. A wrong `advance` is visible — the
word turns up in later gates and can be caught. A wrong `exclude` is terminal
and silent: nothing downstream ever sees the word again, so the failure never
announces itself. The 0.83 disposition score understates the cost of these two
errors relative to the same number of errors in the other direction.

### Finding 4: `npm test` was writing to the real spend ledger

Found while reconciling spend, not by a scorer. `adjudicate()` took its store as
a parameter but read the runs directory from the module constant, so
`adjudicate.test.ts` — which stubs the client with a fixed `cost: 0.0001` —
appended three entries to `runs/spend-ledger.jsonl` on every `npm test`.

The ledger held **39 fabricated entries totalling $0.0039**, across two
fingerprints (30 and 9), neither of which has a persisted run record. Thirty
charges against one fingerprint is itself the tell: in real operation the store
would have returned a reused record instead of paying again.

The direction is safe — the guard over-counted spend, so it would refuse runs
early rather than breach the cap — but the file the README calls the source of
truth for the pilot budget contained charges that never happened.

Fixed by making the runs directory injectable exactly as the store already is,
with the test writing to a temp directory. Verified: `npm test` no longer
changes the ledger's line count. This is the third defect in this family, after
the two the stage 1 review found.

### Operations

| | |
|---|---|
| Calls | 12, one per claim, no retries |
| Prompt tokens | 16,822 |
| Completion tokens | 5,106 |
| Actual spend | `$0.017812` (mean `$0.001484` per claim) |
| Pre-run estimate | `$0.1071` — **6.0x** the actual |
| Latency | min 1,715 ms, median 2,478 ms, max 2,935 ms |
| True spend to date | `$0.0811` of the `$10` cap, `$9.9189` remaining |

The estimate overshot by 6x, and `ASSUMED_OUTPUT_TOKENS = 1600` is most of it:
completions averaged 426 tokens. With the 2x margin on top, the guard is roughly
six times more conservative than the traffic warrants. That is the right
direction for a cap and the wrong number for planning a benchmark — a
three-model run over a larger slice will look unaffordable when it is not.

### Decision

Stop here for the human checkpoint, as #49 requires. Do not begin #50.

**#49 is not met as written.** Its acceptance criteria call for ~200 silver
cases and a 120/40/40 development / regression / hidden-holdout partition. The
human set was deliberately reduced to twelve development cases because the
review burden was too high, so there is no regression set and no hidden holdout.
This run is a prompt smoke test. It supports statements about contract
compliance, about operational cost, and about *where* the judge fails. It
supports no held-out accuracy claim, and `0.8417` should not be quoted as an
accuracy figure.

Open questions for the checkpoint:

1. Does the rubric get a version 3 that asks the forward question explicitly and
   forbids reaching a meaning through another sense of the candidate itself?
2. Is one call per meaning now worth running as a single-variable experiment,
   given finding 2?
3. Should the 39 fabricated ledger entries be removed, or annotated and left in
   place as part of the audit trail?
