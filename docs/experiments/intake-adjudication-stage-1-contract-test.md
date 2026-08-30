# Stage 1 — contract test

First experiment under [`docs/plans/intake-adjudication-evaluation.md`](../plans/intake-adjudication-evaluation.md),
for [#48](https://github.com/cwebley/word-well/issues/48). Prototype lives in
`prototypes/intake-adjudication/`.

The pre-run half of this record was written before the first paid call, so the
stopping condition could not be adjusted after seeing the results.

## Before the run

**Question.** Does one mechanical claim travel the whole path — fixed evidence,
one OpenRouter call, a structured finding, a deterministic disposition, a
persisted record, a Braintrust trace, deterministic scores — without any step
quietly doing something other than what the plan says?

**Hypothesis.** The path holds. The interesting failures are expected to be in
the evidence, not the model: a claim whose root cannot be materialised, or a
rubric that does not tell a closed-book judge what to do when the evidence runs
out.

**Single changed variable.** None. This is the baseline every later run is
compared against.

**Case limit.** Exactly five claims, one per rule kind, hand-picked.

| Claim | Rule kind | Slice | Why this one |
|---|---|---|---|
| `rebut` ← `re` + `but` | affix strip | affix strip | The flagship bogus analysis from spike #44. The claimed root is an adverb. |
| `pastoral` ← `past` + `oral` | compound split | compound split | A string coincidence, and six source meanings across two parts of speech. |
| `naughtiness` ← `naughty` + `-ness` | grammatical derivation | grammatical derivation | A true derivation with one predictable meaning. Unendorsed, so nothing masks the exclude path. |
| `mercurial` ← `mercury` + `-al` | meaning-may-shift derivation | meaning-may-shift derivation | Real derivation, split predictability across four meanings. |
| `overweening` ← ? + `-ing` | lexicalised participle | rootless lexicalised participle | OEWN records no `overween`, so no root evidence exists to supply. |

Between them these cover all four mechanical rules plus the rootless slice, all
three dispositions, endorsed and unendorsed headwords, a polysemous headword,
and one claim carrying an explicit missing-evidence marker.

**Not covered by these five**, and covered by unit tests instead: the
endorsement override rescuing an endorsed word from a fuzzy exclusion. No
hand-picked case lands there naturally, and manufacturing one would have cost a
rule kind. `overweening` covers the other half of the same rule — that
endorsement must *not* rescue a quarantine.

**Two defects found while selecting the cases**, before any model was involved:

1. *The participle rule cannot name roots it should be able to name.* Both
   `build_pool._base_verb` and the exporter that mirrors it try stripping two or
   three characters from a participle, never one. So `convoluted` is recorded as
   rootless even though OEWN has the verb `convolute`. An unknown number of the
   ~7,600 meaning-may-shift claims are rootless for this reason rather than
   genuinely. `overweening` was chosen instead precisely because it is genuinely
   rootless: OEWN records no `overween` at all.
2. *The committed `pool.sqlite` predates the final `build_pool.py`.* Rebuilding
   the workload counts from it gives 4,727 / 2,092 / 1,619 / 7,599 and a union of
   12,797, against the 4,722 / 2,090 / 1,619 / 7,587 and 12,781 recorded in
   `docs/research/candidate-pool-and-intake-filters.md`. The rule kinds and their
   relative sizes are unaffected. The claim digests in the evidence manifest pin
   which build the five cases came from, so this cannot silently change a result.

**Model list.** One cheap model with structured-output support, chosen from the
live OpenRouter catalogue immediately before the run, with the price recorded.

**Expected spend.** Under $0.05. Roughly 800–1,500 prompt tokens per claim.
The guard refuses to start if the estimate exceeds what is left of the $10 cap.

**Stopping condition.** Five claims, once each. No retry of malformed or
contract-violating output, and no repair attempt. Stop and review with a human
before stage 2 regardless of the result.

**Label status.** `provisional-unvalidated`. The expected verdicts in
`labels/contract-test.labels.jsonl` are the author's reading of the exported
evidence, not a human labelling pass. Semantic and disposition scores from this
run are a smoke test and must not be quoted as accuracy.

## After the run

**Model.** `deepseek/deepseek-v4-flash-0731`, temperature 0, upstream **unpinned**.
Chosen from the live catalogue at $0.065/M prompt, $0.180/M completion. The
wizard's first suggestion was `~deepseek/deepseek-v4-flash-latest`, a floating
alias, swapped for the dated pin: a fingerprint that can resolve to a different
model next week is not a fingerprint.

**Spend.** $0.0076 across two runs of five claims, against a $10 cap.
Run A $0.0013, run B $0.0063.

**Braintrust.**
[contract-test · deepseek/deepseek-v4-flash-0731](https://www.braintrust.dev/app/Outthebook/p/WordWell%20morphology%20adjudication/experiments/contract-test%20%C2%B7%20deepseek%2Fdeepseek-v4-flash-0731)

### The path holds

All six contract scorers returned 100% on both runs, across 0 failures in 10
calls. Structured output was valid every time, every enum value was allowed,
claim identity survived, every candidate source meaning was accounted for
exactly once including `pastoral`'s six, every cited identifier existed, and no
response carried a disposition of its own. Persistence, the fingerprint, the
spend guard and the deterministic policy all behaved as designed.

The judge's reasoning on `mercurial` is worth reading in full: it separated
"relating to the metal" (predictable from the root evidence) from the god, the
planet and "liable to sudden unpredictable change", and said of each that it
"requires knowledge of the mythological figure, which is not provided by the
root's recorded meanings". That is the closed-book discipline working.

### Finding 1: an unpinned upstream makes the fingerprint a promise it cannot keep

The two runs share a fingerprint, byte for byte, and disagree.

On `mercurial`, run A judged the god and planet senses `not_predictable`; run B
judged the same two `insufficient_evidence`. The disposition moved from
`advance` to `quarantine` on identical input under an identical configuration.

The cause is visible in the records. Five calls in run B were served by four
different upstreams — Mancer 2, OpenInference, Baidu, Fireworks — because
`OPENROUTER_PROVIDER` was blank. Run B cost 4.9x run A and spent between 231 and
7,045 reasoning tokens per claim depending on who answered. Braintrust recorded
an average of 2 LLM calls per case against 1 completion each, which is
consistent with transport retries against flaky upstreams, though that is
inference from the counts rather than something the traces were read to confirm.

The fingerprint honestly records `upstream_provider: null`. The defect is that
persistence keyed on an unpinned configuration will happily serve a cached
verdict that the same configuration would not reproduce.

**Recommendation.** Treat a pinned upstream as mandatory for any run whose
results are compared or persisted, and make the runner refuse an unpinned run
rather than warn. Model selection at stage 3 then has to choose a provider as
well as a model, which is the correct shape for that decision anyway.

### Finding 2: the rubric does not say what an absent root is

`overweening` was labelled `insufficient_evidence` and came back `unsupported`
in both runs, with the same reasoning both times: "the proposed decomposition
lists only the suffix 'ing' and leaves the root null. Without a root, the claim
that 'overweening' is formed by suffixation cannot be supported." It cited the
`claim.decomposition.root` marker to justify it.

That is a defensible reading of a rubric that offers two routes and does not
separate them:

- *No root was proposed at all*, so there is no claim to support. The judge's reading.
- *A root was proposed but the evidence about it is thin*, so the question cannot be settled. The intended reading.

These are different situations and they take different dispositions —
`unsupported` advances, `insufficient_evidence` quarantines — so the ambiguity
is not cosmetic. It applies to the whole rootless slice.

The judge's reading may also be the better product outcome: a participle whose
root cannot be recovered has no basis on which a fuzzy filter could remove it,
so advancing it is right and quarantining thousands of such words for human
review would buy nothing. That is a decision for the rubric, not for whichever
reading a given model happens to take.

**Recommendation.** Split the rubric's `insufficient_evidence` case in two, and
say explicitly what a null root means. Whichever way it is settled, the change
is one variable and belongs to its own run.

### Scores, and what they are worth

Against `provisional-unvalidated` labels, so these are a smoke test and not
accuracy:

| Score | Run A | Run B |
|---|---:|---:|
| All six contract scorers | 100% | 100% |
| AnalysisSupport | 80% | 80% |
| MeaningPredictability | 100% | 75% |
| MorphologyDisposition | 80% | 60% |
| EffectiveDisposition | 80% | 60% |

Every disagreement in both runs traces to one of the two findings above.
`EffectiveDisposition` tracks `MorphologyDisposition` exactly because no
hand-picked case produced an endorsed exclusion, so the override never fired.
Unit tests cover it in both directions.

### Operations

| | |
|---|---|
| Cost per claim | $0.00026 run A, $0.00127 run B |
| Full-pool projection, 12,797 claims | $3.30 to $16.20, on this spread |
| Latency, run B | median 16.2s, max 58.8s |
| Tokens per claim, run B | 1,433 to 9,233, of which 231 to 7,045 reasoning |
| Malformed output | 0 of 10 |
| Provider errors surfaced | 0 |

The projection spans 5x because the upstream was unpinned, which is finding 1
restated in money. A pinned upstream is what makes a full-pool estimate
meaningful enough to approve.

### Decision

Stage 1's question was whether the next experiment would measure what it thinks
it is. It would not have: an unpinned upstream would have made every later
comparison a comparison of routing, and the rubric ambiguity would have split
the rootless slice unpredictably across models. Both were found for under a
cent.

Do not start stage 2 until:

1. A pinned upstream provider is required rather than optional.
2. The rubric distinguishes an absent root from thin evidence about a real root.
3. The five provisional labels are confirmed or corrected by a human, including
   whether `overweening` should read `unsupported`.

Each is one changed variable and each needs its own run.

## Changes made at the checkpoint

Reviewed with the user immediately after the run. Four changes, none of them
tuned against the results.

**A pinned upstream is now required.** `OPENROUTER_PROVIDER` has no default and
the runner refuses to start without one. `npm run models -- <model-id>` lists the
eligible upstreams for a model: the one used here is served by **22 of them, at
prices spanning 14x** ($0.030/M to $0.440/M for the same model identifier). The
five persisted records are therefore unreachable, which is correct — their
fingerprint recorded a configuration that no longer exists.

**Root recovery was widened, and root *validation* was abandoned as impossible.**
The participle rule stripped two or three characters from a word and never one.
Checking OEWN for something to validate a recovered root against found nothing:
participial adjectives carry **no derivation link to their base verb**.
`convoluted` has three sense relations, none to `convolute`; `exacting` has two,
neither to `exact`. `naughtiness -> naughty` resolves normally, so this is a real
gap in the data rather than a bad query.

So the extractor now casts the widest defensible net and adjudication does the
validating, which is what the gate is for. Measured over the delivery band, root
recovery went from 0 to **923 of 1,091** rootless participles: 773 directly, 150
from outside a negative prefix (`unflustered` -> `fluster`). False candidates
such as `brinded` -> `brine` are expected and cheap; the judge rejects them for
$0.0003 exactly as it rejected `rebut` <- `but`. A missed root is the expensive
error, because the word never reaches a judge at all.

**The 168 remaining are not participles.** They are dominated by the denominal
`-ed` pattern meaning "having X": `rawboned`, `bighearted`, `brokenhearted`,
`bowlegged`, `bespectacled`, `colonnaded`, `bilobed`. There is no verb behind
them because the rule's premise is wrong about these words, not because the
search failed. A rule that mis-fired has no basis to remove a word, so these
advance.

**Policy is now `morphology-policy/2`.** The order of the two checks was
reversed. v1 asked whether any meaning was undecided before asking whether any
meaning was clearly not predictable, so a single undecided meaning could
quarantine a word there were already grounds to advance. That is precisely how
the two runs disagreed: run A judged `mercurial`'s god and planet senses
`not_predictable` and advanced; run B judged the same two
`insufficient_evidence` and quarantined, even though both runs agreed that
"liable to sudden unpredictable change" does not follow from the root.

Replaying both stored findings through v2 changes `mercurial` from quarantine to
advance and leaves the other four untouched. **The two runs now agree on all
five.** The reasoning stands on its own: quarantine means the evidence cannot
settle the question, but one meaning that demonstrably teaches something the
parts do not give has already settled it. An undecided meaning beside it cannot
withdraw that reason.


## The run of record

After the four checkpoint changes, re-run against
`deepseek/deepseek-v4-flash-0731` pinned to **`morph/bf16`**.

The upstream was chosen on precision, not price. OpenRouter's endpoint listing
exposes a `quantization` field, and the cheap upstreams are mostly fp4 or fp8:
`sail-research/fp4`, `baidu/fp8`, `open-inference/fp8`. Only `morph/bf16` serves
the model at full precision. A harness whose purpose is measuring a model should
not be measuring a 4-bit compression of it, and at this volume the difference is
a rounding error.

**Case set changed.** `overweening` is now filtered before adjudication, so it
makes no call. `convoluted` replaced it as the fifth judged claim, chosen because
it is the word that exposed the extractor bug: it reads as rootless under the old
stripper and recovers `convolute` under the new one. The two together show both
sides of the filter — same rule, root absent in one and found in the other.

| | Result |
|---|---|
| All six contract scorers | **100%** |
| AnalysisSupport | **100%** (was 80%) |
| EffectiveDisposition | **100%** (was 60%) |
| MorphologyDisposition | 80% (was 60%) |
| MeaningPredictability | 83% (was 75%) |
| Malformed output | 0 of 5 |
| Cost | $0.001304, $0.00026 per claim |
| Reasoning tokens | **0** on every claim, against 231–7,045 unpinned |
| Latency | 8.7s to 23.2s, median 11.2s |

**Reliability.** The recorded run was followed by two `--fresh` probes, which
bypass persistence so the same fingerprint can be asked twice. All three runs
agree on all five claims, including every per-meaning verdict. Same-verdict rate
3/3. That is the first evidence that pinning the upstream fixed the instability,
and it is the direct contrast with the unpinned runs, which disagreed at n=2.

`--fresh` was added for this, and stage 5 needs it regardless: persistence
answers "have we paid for this already", while a reliability probe has to ask the
same question twice and see whether the answer holds. Reusing a record there
would manufacture perfect agreement.

**Full-pool projection.** $3.34 for 12,797 claims at the measured rate, against
the $3.30–$16.20 spread the unpinned runs produced. The projection is now worth
approving because it is built on one machine's measured behaviour.

### One disagreement remains, and it is the label that is wrong

`convoluted`'s second meaning, "highly complex or intricate and occasionally
devious". I labelled it `predictable`, arguing that the root's two verb senses
supply it: twisting-together gives *intricate*, and the sophistry sense gives
*devious*. The judge returned `not_predictable` in all three runs, reasoning that
the meaning "is a figurative extension beyond the literal 'coiled' sense; the
root's verb sense about misleading or being vague does not directly yield this
meaning."

Re-reading the evidence, the judge is right and the label was a stretch. The
sophistry sense is about *misleading*, not about being *intricate*, and stitching
half of one root sense to half of another is not a route a learner would take.
The disposition is unaffected either way — both readings advance under
`morphology-policy/2` — but the per-meaning label should be corrected before it
is promoted to `human-validated`.

This is recorded rather than quietly fixed because changing a label to agree with
a model is the classic way an evaluation stops measuring anything. The
justification has to stand on the evidence, and a human has to make the call.

## Close-out

Reviewed with `/code-review`, which found two real defects in the spend guard,
both in code committed an hour earlier and both fixed:

**The budget guard priced the wrong machine.** `fetchPrice` read the catalogue's
headline price for a model id, but a model id is served by many upstreams at
rates spanning 14x. Pinning `morph/bf16` while estimating against the catalogue's
$0.065/$0.180 under-priced the run by roughly half. It now reads the pinned
endpoint's own price and fails loudly if the pinned upstream does not serve the
model. The five-case estimate moved from $0.0037 to $0.0057.

**`--fresh` spent money the cap could not see.** A reliability probe persists
nothing by design, and `spentSoFar` summed the run records, so both probes were
invisible to the guard. Every paid call now appends to `runs/spend-ledger.jsonl`
whether or not its record is stored. Reported spend was $0.0076; actual was
$0.0095.

The review also observed that filtering `overweening` left no live case carrying
a missing-evidence marker, so AC2 and the `insufficient_evidence` path rested on
unit tests alone. Measuring which markers can fire at all, across the band:

| | claims | |
|---|---:|---:|
| Fully evidenced | 12,565 | 98.2% |
| No root proposed, filtered before adjudication | 168 | 1.3% |
| Root has meanings but no frequency | 64 | 0.5% |
| **Root has no recorded meanings** | **0** | **0.0%** |

Zero, and structurally so: every path that finds a root requires the root to be
in OEWN, so a root without meanings cannot be produced. The marker exists in the
schema and cannot fire.

The consequence is worth stating plainly, because it is not what the plan
assumed. **After the filter, an evidence gap can no longer produce
`insufficient_evidence`.** Quarantine is reachable only when the model declares
uncertainty from its own reading, never because the extractor handed it a hole.
That follows from removing the holes deliberately, but it means the quarantine
branch is thinly exercised by design, and stage 6 should not be the first place
anyone notices.

`nonplussed` was added as the sixth case on that basis: it carries the only
marker the extractor can produce, and it is a negative control rather than a
quarantine test. The rubric says frequency is not evidence about whether a
decomposition is real, so a marker there must not change the verdict. It did not
— and the case turned out to earn its place twice over, because it is also the
only case that fires the endorsement override.

### Final result

Six claims, all ten scorers at **100%**, including every semantic and disposition
score now that the labels are human-validated.

| Claim | Verdict | Disposition |
|---|---|---|
| `rebut` <- `re` + `but` | unsupported | advance |
| `pastoral` <- `past` + `oral` | unsupported | advance |
| `naughtiness` <- `naughty` + `-ness` | supported, predictable | **exclude** |
| `mercurial` <- `mercury` + `-al` | supported, 3 of 4 not predictable | advance |
| `convoluted` <- `convolute` + `-ed` | supported, 1 of 2 not predictable | advance |
| `nonplussed` <- `nonplus` + `-ed` | supported, both predictable | exclude -> **advance**, endorsement override |
| `overweening` <- ? + `-ing` | *not judged* | advance, filtered before adjudication |

One label was corrected at the checkpoint. `convoluted`'s "highly complex or
intricate and occasionally devious" was labelled `predictable` on the argument
that the root's two verb senses supply it. The judge returned `not_predictable`
in all three runs, reasoning that the sophistry sense is about misleading rather
than about being intricate. The judge is right: joining half of one root sense to
half of another is not a route a learner takes. Recorded rather than quietly
fixed, and confirmed by a human, because a label changed to agree with a model is
how an evaluation stops measuring anything.

All six labels are now `label_status: human-validated`.

**Total spend $0.0097 of the $10 pilot cap**, across 21 paid calls.

### Decision

Stage 1 is complete. The contract path holds, the two defects it found are fixed,
and the configuration is now reproducible. Nothing remains before stage 2. The labels are validated, the rubric ambiguity
was removed by removing the case, and the pinning question is closed.

Carried forward as named stage-3 candidates, neither of them blocking:

- **One call per meaning.** Fan out polysemous claims instead of asking about all
  meanings at once. 58% of claims have a single meaning so it is a no-op for most
  of the pool, and the 42% it would affect are the ones where seeing the meanings
  side by side appears to help. Worth measuring against golden cases rather than
  arguing about.
- **The participle rule's shape.** It fires on `bighearted`, `bowlegged` and
  `bespectacled`, which are not participles at all. The filter advances them
  correctly, but a rule that mis-fires 168 times in one band is worth revisiting
  when the deterministic rules are next touched.
