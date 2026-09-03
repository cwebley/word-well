# Intake adjudication evaluation plan

Plan for [#46](https://github.com/cwebley/word-well/issues/46), following the
candidate-pool findings in
`docs/research/candidate-pool-and-intake-filters.md`. This is a prototype plan,
not the production intake design. The candidate intake ADR remains #47 and
follows the experiments described here.

V15's sensitive behavioural evaluation is a privacy exception to the ordinary
committed-dataset approach below. See
`docs/plans/intake-adjudication-v15-behavioral-evaluation.md` for the private,
versioned artifact and manual-now, CI-later workflow.

## Revision, 2026-08-30: morphology is no longer the selection gate

**Read this before acting on anything below it.** Stage 2 changed the plan's
direction. The sections on fixed evidence, the contract, scores, reproducibility,
spend controls, secret handling and prototype shape all still hold. The gate
ordering, the golden-case sizing and the staged-experiment list do not.

Evidence is in `docs/experiments/intake-adjudication-stage-2-prompt-smoke.md`.

**What stage 2 found.** Across twelve human-labelled claims, `analysis_support`
— *is this word actually built the way the mechanical rule claims* — scored
12/12, including both invented decompositions. Every error fell in per-meaning
predictability. On review most of those disagreements were label errors rather
than judge errors, which is the second time this has happened; stage 1 closed on
the same finding. A judgment the domain owner cannot apply consistently cannot
be calibrated, and therefore cannot be a gate.

**Three consequences.**

1. **Morphology loses its exclude path.** It stops deciding which words are
   served and becomes content preparation: given a word already selected, is the
   decomposition we would show a learner real? That is the half that scored
   12/12. A future `morphology-policy/3` has no `exclude`, which also retires
   the endorsement override, since that exists only to rescue a word from a
   fuzzy exclusion.

2. **The gate order inverts.** Audience usefulness becomes the selection engine
   and runs first, on the full pool. Morphology runs afterwards on the
   survivors, which is both correct and much cheaper.

   ```text
   candidate pool
     -> deterministic factual filters      (incl. demonym, display-form, eponym marker)
     -> audience usefulness   #56          <- selection happens here
     -> sensitive language    #57
     -> morphology adjudication            <- content preparation, no exclude
     -> eligible candidate
     -> lesson drafting and content evaluation
   ```

3. **Golden sets shrink by an order of magnitude.** The 200-case /
   120-40-40 design was abandoned: the labelling burden was unsustainable and
   the labels it did produce contained errors that were later retracted. Target
   15-25 curated cases per gate, split capability / regression, using
   categorical buckets rather than a verdict per source meaning. This follows
   Scott Moss's eval discipline (Master.dev AI Engineering Fundamentals, lessons
   4-5), which ships 18-23 cases for an entire agent and is explicit that cases
   scoring badly today are what give later work something to lift.

**A usefulness gate is not a morphology gate.** Morphology asks a question with
an answer a lexicographer could confirm. Usefulness asks a question whose only
authority is the product owner, so the accuracy ceiling is their own
self-agreement. Measure that before tuning against a set, and expect a lower bar
than a factual gate warrants.

**Errors there are asymmetric.** Selection is a global hard exclude by explicit
product decision. A wrong admit is visible; a wrong exclude is terminal and
silent. Lean toward admitting, and spend review effort on what the gate lets in.

**Retention audit.** Roughly 100 endorsed words, sampled randomly within strata,
carrying no labels and kept disjoint from every golden set. It reports one
number — retention rate — and exists to catch unexplained movement in it, never
to be scored against or tuned toward. Endorsement can seed golden cases or serve
as an independent audit, not both: tuning against endorsed words makes the audit
report its own training signal. Keeping the two pools disjoint buys both, and
this is the one holdout that costs no labelling time because editors already did
the work.

**Ticket state.** #50-#55 are parked with the reasoning recorded on each. #56 is
unblocked and promoted. #49 is complete to its checkpoint and explicitly does
not meet its original acceptance criteria.

## Goal

Build a WordWell-specific intake adjudication workflow that is also a legible
portfolio example of evaluation-driven AI engineering.

The workflow uses deterministic filters for claims code can establish, then
small LLM gates for semantic decisions code cannot make. Each gate has its own
question, evidence, rubric, golden dataset, scores, and policy. There is no
general-purpose intake agent and no omnibus prompt.

The first gate adjudicates mechanical claims about word formation. Later work
will address audience usefulness and sensitive language separately. Lesson
generation and content evaluation remain separate again.

## Measured workload

The delivery-band workload is 12,781 distinct headwords flagged by at least one
fuzzy rule while passing the measured factual predicate. It contains 578
distinct endorsed headwords, not 623.

The four rule rows contain 623 endorsement occurrences because 45 endorsed
headwords carry two flags. Summing those rows double-counted them:

```text
533 headwords flagged by one rule
 45 headwords flagged by two rules
---
578 distinct endorsed headwords
623 per-rule occurrences
```

Endorsement is not a golden label for morphology. It says that an editorial
source found a headword worth teaching. An endorsed word may still have a real,
predictable derivation. Endorsement remains a useful policy override and an
external retention audit, while morphology accuracy is measured against a
human-validated golden dataset.

## Intake gates

> **Superseded in part.** The ordering below is pre-stage-2. Morphology no
> longer selects words and no longer runs first; see the Revision above.

The intended intake sequence is:

```text
candidate pool
  -> deterministic factual filters
  -> morphology adjudication
  -> audience usefulness, later work
  -> sensitive language, later work
  -> eligible candidate
  -> lesson drafting and content evaluation
```

The gates answer different questions:

- Deterministic factual filters establish shape, source resolution, spelling
  status, frequency range, and factual source labels.
- Morphology adjudication asks whether a claimed analysis is supported and
  whether each meaning is predictable from the claimed root or components.
- Audience usefulness asks whether at least one live meaning is useful to the
  intended adult learner. It does not belong in the morphology prompt.
- Sensitive-language adjudication handles offensive, derogatory, and other
  audience-risk cases. Wiktionary labels are inputs, not complete labels.
- Content evaluation judges a drafted lesson. It uses the existing
  complete-lesson evaluation vocabulary and is not intake adjudication.

## Unit of judgment

The unit is a mechanical claim, not a headword:

```text
headword + rule kind + proposed root or components
```

A headword may carry several claims. Each claim is retained and judged
separately. A word-level disposition is derived after all applicable claims and
meanings have been considered.

This distinction prevents three counting and reasoning errors:

- Per-rule counts do not masquerade as distinct-headword counts.
- A valid claim does not hide a second bogus claim on the same word.
- A predictable sense does not hide another sense that teaches something new.

## Fixed evidence

Morphology adjudication is closed-book. Every model receives the same extracted
evidence:

- Normalized headword, display form, and part of speech.
- Rule kind and exact proposed decomposition.
- Candidate definitions and examples with stable source-meaning identifiers.
- Root or component definitions and examples with stable identifiers.
- Candidate and root or component frequency context.
- Pinned source release and extraction version.
- Explicit markers for missing evidence.

The prompt does not include endorsement. The model does not browse. Fixed
evidence makes model and prompt comparisons reproducible and prevents retrieval
changes from being mistaken for adjudication changes.

The existing pool does not retain enough evidence for every claim. In
particular, lexicalised participles may have no stored root, and derivational
rows omit supporting source-meaning identifiers. Evidence export must
materialise these claims before they can be judged.

## Verdict and policy

The model returns findings, not a serving decision:

```yaml
analysis_support: supported | unsupported | insufficient_evidence
meanings:
  - sense_ids: [stable-source-meaning-id]
    predictability: predictable | not_predictable | insufficient_evidence
    evidence_ids: [stable-evidence-id]
    rationale: concise explanation
diagnostic_confidence: optional
```

The rationale records the basis for review. It is not hidden chain-of-thought.
Every cited identifier must exist in the input evidence.

Model self-confidence is diagnostic only. It never controls disposition.
Observed evidence completeness, structured-output validity, golden-set results,
and repeated-run consistency determine whether a configuration is trusted.

Versioned deterministic policy derives one of three intake dispositions:

- `advance`: continue to the next gate.
- `quarantine`: evidence or adjudication is insufficient for automation.
- `exclude`: retain the candidate and verdict as data, but omit it from the
  effective intake set under this policy version.

For an unendorsed headword, morphology excludes only when a claim is supported,
every adequately evidenced meaning is predictable, and no meaning remains
uncertain. An unsupported claim advances. Any non-predictable meaning advances
to the later usefulness gate. Insufficient evidence quarantines.

Endorsement overrides fuzzy morphology after adjudication. It never overrides a
factual filter. Mechanical attributes, judge findings, endorsement, and
effective disposition remain four separate layers.

## Reproducibility and persistence

Every model output is stored by a fingerprint containing:

- Exact structured-input digest.
- Pinned source releases and source revision identifiers.
- Extraction and deterministic-rule versions.
- Provider and exact model identifier.
- Prompt, rubric, and output-contract versions.

Prompt version alone is not a safe cache key. A source, parser, rule, model,
rubric, or contract change may alter the valid result while leaving prompt text
unchanged.

Experiment response caching and adjudication persistence serve different jobs.
Persistence prevents paid duplicate work for an unchanged configuration.
Braintrust response caching may speed prompt development, but it must be
disabled when measuring repeated-run reliability.

## Dataset strategy

### Silver cases

Assemble at least 1,000 provisional cases automatically from mechanical flags,
Wiktionary labels, endorsements, known regressions, random samples, multi-flag
headwords, and polysemous headwords. Models may propose labels and explanations.

Silver cases broaden coverage and help select human-review work. They are not
reported as ground truth.

### Golden cases

> **Superseded.** The 200-case slice table and the 120/40/40 partition were
> abandoned at stage 2 as unsustainable to label. Target 15-25 curated cases per
> gate; see the Revision above. The table is retained as the record of what was
> originally planned.

Human-validate 200 cases, initially distributed as follows:

| Slice | Cases |
|---|---:|
| Affix strip | 40 |
| Compound split | 40 |
| Grammatical derivation | 35 |
| Meaning-may-shift derivation | 45 |
| Rootless lexicalised participles | 20 |
| Multi-flag and polysemous stress cases | 20 |
| **Total** | **200** |

Each slice includes obvious positives, bogus analyses, supported but
meaning-shifting cases, insufficient-evidence cases, endorsed and unendorsed
headwords, known regressions, and random cases. Early experiments may justify a
different distribution; any change is recorded rather than silently replacing
the original set.

Partition the set before prompt iteration:

```text
120 development cases
 40 known-regression cases
 40 hidden holdout cases
```

The holdout labels remain outside normal development commands and are used once
after selecting the model, prompt, evidence shape, and policy.

### Local labelling

Committed JSONL is the canonical dataset. A generated local review page shows
the claim, meanings, fixed evidence, provisional label, and rubric. It supports
accept, correct, and uncertain decisions, retains local progress, and exports
validated JSONL.

Braintrust consumes validated cases for experiments but is not their sole home.
This keeps the evaluation inspectable without access to a third-party account.

## Scores

### Contract scores

Deterministic scorers verify:

- Structured output is valid.
- Every enum value is allowed.
- Claim identity is preserved.
- Every input meaning is accounted for.
- Every cited evidence identifier exists.
- The model did not invent a disposition.

### Semantic scores

For analysis support and meaning predictability, report exact agreement,
per-class precision and recall, macro F1, and confusion matrices. Split metrics
by rule, difficulty, polysemy, missing evidence, and endorsement status.

A scorer returns `null` when its question does not apply. Predictability, for
example, is not scored when the claimed analysis is unsupported.

### Policy scores

Report:

- Advance recall.
- Exclude precision.
- Disposition accuracy.
- Quarantine rate.
- Coverage, the share receiving an advance or exclude decision.
- Selective accuracy, accuracy among non-quarantined decisions.

The starting target is at least 98% recall for human-labelled advance cases.
The development data selects any final threshold. The hidden holdout confirms
the frozen choice rather than tuning it.

Endorsement retention is reported separately. Endorsements are not used to
calculate morphology precision or recall.

### Reliability and operations

On repeated cases, report same-verdict rate, all-runs-correct rate,
any-run-correct rate, disposition flips, and quarantine flips. Normal operation
runs a claim once, so all-runs-correct is more important than occasional
success.

Also report input, output, and reasoning tokens; cost per claim; projected
full-pool cost; median and p95 latency; provider errors; and malformed-output
rate.

There is no decision-making composite score. Models must clear correctness and
retention requirements first. Among qualifying models, prefer higher selective
accuracy, lower quarantine, stronger reliability, then lower cost and latency.

## Staged experiments

> **Superseded from stage 3 onward.** Stages 1 and 2 ran as written and are
> recorded in `docs/experiments/`. Stages 3-8 assume the 120/40/40 corpus and
> morphology-as-selection, and are parked as #50-#55. The pre-run / post-run
> recording discipline in the last paragraph still applies to every run.

Every stage ends with a human checkpoint. The next stage does not start until
the results, failures, case mix, and cost are reviewed.

1. **Contract test.** Five hand-picked cases with one cheap model. Verify the
   evidence payload, structured output, tracing, persistence, and scorers.
2. **Prompt smoke test.** Twelve cases with one likely midrange model. Inspect
   reasoning quality and obvious prompt or evidence failures.
3. **Small model benchmark.** Run 48-60 stratified cases once against three
   models: cheap, strong, and stronger, from multiple providers.
4. **Model confirmation.** Run the winner and runner-up against all 120
   development cases.
5. **Reliability.** Repeat 30-40 difficult and regression cases three to five
   times with response caching disabled.
6. **Hidden holdout.** Run the selected model and frozen configuration once on
   the 40 hidden cases.
7. **Pool pilot.** Run 100-250 unlabelled real claims. Inspect disposition
   rates, uncertainty, disagreements, and unexpected inputs.
8. **Full pool.** Proceed only after reviewing a fresh estimate derived from
   measured token usage and approving the spend.

Before each run, record its question, hypothesis, single changed variable, case
limit, model list, expected spend, and stopping condition. After it, record
scores, slices, representative failures, evaluator or fixture problems, actual
spend, and the next decision.

## Provider and spend controls

Use OpenRouter for the pilot to compare providers through one interface. Pin the
exact model and provider during experiments; fallback or price-based routing
would introduce another variable. Use a project-specific prepaid key, no
automatic recharge, and a $10 pilot cap.

No run starts when its estimate exceeds the remaining pilot budget. The full
pool always requires separate approval. ChatGPT and Claude subscriptions do not
fund these API calls.

Select current model identifiers immediately before the small benchmark. The
shortlist contains the cheapest credible structured-output model, a strong
midrange model from another provider, and a stronger reference model. Record
the prices used for the decision.

Baseline experiments retry transport failures such as provider timeouts while
retaining those failures in telemetry. They do not retry malformed or
semantically invalid output. A targeted repair attempt is a separate later
experiment whose accuracy, latency, and cost are measured.

## Secret handling

Before creating credentials, ignore `.env.local` and commit a placeholder-only
`.env.example`. Store the prototype credentials in a scoped local environment
file. The OpenRouter and Braintrust keys never enter chat, shell command text,
datasets, traces, issue bodies, or committed files.

The current repository does not ignore environment files, so secret setup must
not precede that guardrail.

## Prototype shape

The prototype has four narrow modules:

```text
Python evidence exporter
  scratch pool + pinned sources -> versioned JSONL claims

TypeScript adjudication runner
  claim + provider/model + prompt -> structured finding

Braintrust evaluation
  golden cases + runner + deterministic scorers -> experiments

Local review and pool browsers
  silver cases -> validated JSONL
  mechanical | judged | effective | differences | uncertain
```

The adjudication runner is the shared core used by experiments and any later
workflow prototype. This prevents the eval from testing a duplicate prompt or
contract. Production integration remains out of scope.

## Documentation standard

Every experiment records:

- Experiment identifier and Braintrust link.
- Question and hypothesis.
- Single changed variable.
- Dataset and configuration fingerprints.
- Provider, model, prompt, rubric, and contract versions.
- Aggregate and sliced scores.
- Reliability, token, cost, and latency measurements.
- Representative failures in both disagreement directions.
- Evaluator or fixture defects discovered.
- Decision and next experiment.

The final findings document explains the architecture, dataset provenance,
labelling rubric, model comparison, coverage-versus-accuracy tradeoff, error
analysis, cost projection, negative experiments, recommendation, and residual
risks. It preserves cases where a score fell because the evaluator became more
honest.

This follows the method taught in Master.dev's *AI Engineering Fundamentals*:
golden datasets and baselines in *Why Evals Matter*, deterministic and
inapplicable scorers in *Code-Based Scorers*, one focused change per run in
*Improvement Loop*, and a production data flywheel in *Wrapping Up*. WordWell
adapts that method to a fixed LLM workflow rather than an agent loop.

## Scope and sequence

#46 delivers the morphology prototype, reusable evaluation harness, local
labelling workflow, staged model selection, browser comparisons, and findings.
It commits no production schema, migration, or pipeline integration.

Follow-up work covers:

- Audience usefulness adjudication.
- Sensitive-language adjudication.
- Production intake orchestration and persistence.
- Candidate intake ADR #47, after the gate findings settle the primary intake
  mechanism.

Lesson generation, lesson evaluation, and learner-time model calls remain out of
scope.
