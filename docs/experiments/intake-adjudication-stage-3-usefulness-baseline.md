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

## Results

Nineteen meanings, nineteen calls, no repairs. Every record persisted, and the
run reconciles exactly against the ledger: nineteen entries, `$0.002358`,
matching the sum of `usage.cost_usd` across the nineteen records to the cent.

**One deviation from the pre-run record.** `morph/bf16` returned `429 Provider
returned error` on two consecutive attempts, after the SDK's transport retries.
It is the only `bf16` endpoint serving this model, so the run went to
`deepinfra/fp8` instead. `npm run models` succeeded on the same key throughout,
so the limit was the upstream's, not the account's. The quantization is part of
the config fingerprint, so this is recorded rather than hidden, and no persisted
record from an earlier stage was reused across the change. A later `bf16` run
would produce new fingerprints and new records, not a contradiction.

### Scores

| Scorer | Mean | Note |
|---|---|---|
| ContractSchemaValid | 1.0000 | 19/19 |
| ContractEnumsAllowed | 1.0000 | 19/19 |
| ContractMeaningIdentity | 1.0000 | 19/19 |
| ContractMeaningCoverage | 1.0000 | every meaning judged |
| ContractNoInventedDisposition | 1.0000 | the alarm staying silent |
| **ContractEvidenceExists** | **0.6326** | see finding 1 |
| **HeadwordDisposition** | **0.8333** | 10/12 |
| **NoSilentExclusion** | **1.0000** | 12/12 — nothing the owner wanted was lost |

### Finding 1: the contract holds, but `evidence_ids` does not earn its place here

Five of the six contract scorers are perfect. The sixth is not, and it is a
contract design fault rather than a judge failure.

Pooled across all 34 citations, 15 are legal identifiers and 19 are not — 44%.
The scorer reports 63%, which is the mean of per-headword ratios; headwords where
the judge cited only the sense id score 1.00 and pull the average up. Both
numbers are honest measures of different things and neither is an accuracy claim.

What the other 19 are is the point. Every one is **real content from the supplied
evidence** — synset members (`felicitous`, `glad`), example text (`a desert
nomad's austere life`), definition fragments, the Zipf value. Checked
specifically: `laconic`'s quoted `the laconic reply: 'yes'` *is* in the supplied
examples. Nothing was hallucinated and the closed-book rule held.

The field is simply asking a question with one possible answer. For morphology it
earned its keep because a claim carried several components each with their own
sense identifiers, so *which of these did you use* was real. Here each call
carries exactly one meaning and therefore exactly one citable id, so the judge
either restates it — adding nothing — or fills the field with what it actually
leaned on. This is the first thing to fix, and it is a contract change, not a
prompt change.

### Finding 2: both misses are admits, at the two ends of the tier-2 band

Ten of twelve. `herbivorous` and `happy` both came back `advance` where the label
says `exclude`. There is not one error in the other direction, and
`NoSilentExclusion` is 12/12: no word the owner wanted was lost.

That is the failure direction the plan asks for. Selection is a global hard
exclude, so a wrong admit turns up in the app and can be caught while a wrong
exclude is terminal and silent. A thin prompt that errs by admitting is a better
starting point than one that errs by excluding, and the score understates that.

### Finding 3: the judge reads frequency monotonically; the criterion is a band

The mechanism behind `happy` is legible in the rationales, and it is not
carelessness. On `happy` the judge wrote that the meaning is "a core, everyday
sense of a **very frequent** English word" and concluded it is therefore
"foundational and useful". On `pinnate` and `Texan` it wrote that "the **low
frequency** further indicates it is not a core academic word".

So frequency is being used in one direction: common counts *for*, rare counts
*against*. The criterion is not directional. Tier 2 is a band, with everyday
words below it and domain-technical words above, and version 1 never says there
is an upper bound — so the judge cannot apply one. The evidence was sufficient;
`happy`'s Zipf of 5.38 was right there in the prompt and was read as support.

This is the clean case for the start-thin discipline. The clause that fixes it
now traces to a named case, and would have been guesswork written up front.

### Finding 4: "academic" is being read as "used in an academic discipline"

`herbivorous` was admitted because it is "a precise scientific term used in
academic fields such as biology, ecology, and animal science". That is tier 3
arriving through the word *academic* in the criterion itself.

`pinnate` is the control, and it was rejected correctly — as "a highly
specialized botanical term". The difference between them is not the judge: it is
that `pinnate`'s gloss self-marks its domain, `(of a leaf shape)`, and
`herbivorous`'s gloss, `feeding only on plants`, reads as general prose. So the
gate currently catches domain-technical words only when OEWN happens to announce
the domain, which is not a property anything downstream can rely on.

### Finding 5: the two register rejects came back correct with no register evidence

`homegirl` was the pre-run hypothesis's most likely miss. It was rejected, on the
gloss alone: "a slang term for a female gang member... informal, subcultural
context". `dimwit` likewise: "a colloquial, informal insult".

These are exactly the two words `wik_labels` would have helped with, and they did
not need it. The register signal was already recoverable from the gloss and the
synset members (`nitwit`, `half-wit`, `doofus`), which is what the evidence
decision predicted. That decision cost two of six keeps a misleading label and
bought nothing measurable; this run is the evidence that it bought nothing
because there was nothing to buy.

### Operations

| | |
|---|---|
| Calls | 19, one per meaning, no retries, no repairs |
| Prompt tokens | 7,255 |
| Completion tokens | 9,964, of which **7,384 reasoning** |
| Actual spend | `$0.002358` (mean `$0.000124` per meaning, `$0.000197` per headword) |
| Pre-run estimate | `$0.0121` — **5.1x** the actual, in line with stage 2's 6.0x |
| Latency | min 5,684 ms, median 10,562 ms, max 49,333 ms |
| True spend to date | `$0.0835` of the `$10` cap, `$9.9165` remaining |

Latency is four times stage 2's median, and the reason is visible in the token
split: three quarters of the completion budget is hidden reasoning. Nothing here
argues for or against that — it is recorded so a later model comparison has a
baseline that is not mistaken for a property of the gate.

Projected over the full pool, the per-meaning cost is the number that matters,
not the per-headword one, because the fan-out scales with meanings.

## Decision

Stop here for the human checkpoint, as #56 requires.

**What this run supports.** The path holds end to end for a second gate: fixed
evidence, one strict contract, a per-meaning fan-out, a deterministic fold, a
persisted record, a reconciled ledger. The failure direction is the safe one. The
two misses have identified mechanisms rather than being noise.

**What it does not support.** Any accuracy claim. Twelve cases labelled by one
person, six of which are trip-wires that must never break, cannot carry one, and
`0.8333` should not be quoted as accuracy. There is no capability partition and
no hidden holdout. The retention audit has been built but not run, so there is no
resolution instrument behind this number yet.

**Deliberately not done in this session.** No prompt v2. The pre-run record
forbids iterating in the same session as the baseline, and the working-decisions
comment puts the owner in front of the failures first. Findings 3 and 4 each name
a single clause that would trace to a specific case, which is the shape a
revision is supposed to have — but writing them now would be choosing what
counts as useful, and that is the one judgment this gate cannot borrow.

Open questions for the checkpoint:

1. Does `evidence_ids` survive into `usefulness-finding/2` at all, given finding
   1? The options are dropping it, or widening what counts as citable to the
   evidence's content rather than its identifiers.
2. Findings 3 and 4 both point at the same root — version 1 states a direction
   where the criterion is a band. One clause naming the tier-1 and tier-3 edges,
   or two clauses traced separately?
3. Run the retention audit now, at roughly `$0.03` for ~100 words, to get a
   resolution instrument behind the next prompt change? It costs no labelling
   time and the sample is already drawn.

---

# Stage 3b: contract v2

## Pre-run record

**Question.** Does giving every piece of evidence a citable label fix the
`evidence_ids` field, and what does the judge cite when it can cite honestly?

**Changed variable.** The contract and the evidence rendering, together — they
cannot be separated, since numbering the evidence is what the new field cites.
`usefulness-finding/2`, `usefulness-prompt/2`, `usefulness-rubric/2`. **The
criterion text is byte-identical to version 1.** Model, endpoint, temperature,
dataset and labels all held constant.

Two changes, both traced to the baseline:

1. **Numbered evidence.** Version 1 asked for "identifiers from the supplied
   evidence" when the sense id was the only identifier in the prompt. Measured
   result: the scorer rewarded saying less. `Texan` scored 100% by echoing one
   id; `pinnate` scored 0% for naming the three things it actually reasoned
   from — `frequency_Zipf_2.17`, `definition_leaf_shape_featherlike`,
   `part_of_speech_a`, all real evidence, none of it nameable.
2. **`diagnostic_confidence` removed.** The one field with no consumer. Seventeen
   of nineteen values landed between 0.85 and 1.0, and two came back as `3` on a
   scale documented as 0 to 1.

**Expected spend.** `$0.0184` pessimistic. **Stopping condition.** Nineteen
calls. No prompt-criterion change in the same run.

## Results

Nineteen calls, no repairs, ledger reconciles.

### The citation field works

**67 of 67 citations legal, against 44% pooled under version 1.** Every one
points at a label that exists.

The metadata is worth more than the score. Across nineteen calls the judge cited:

| Evidence | Times cited |
|---|---|
| example | 20 |
| definition | 19 |
| **frequency** | **13** |
| synonyms | 10 |
| part of speech | 5 |

Frequency is read in thirteen of nineteen calls. Under version 1 that was
guesswork; it is now measured, and it is the instrument the `happy` question
needed.

### The score fell, and the composition is what matters

`HeadwordDisposition` 10/12 -> 9/12. Two verdicts moved, in opposite directions.

**`happy` sense 1 flipped to `not_useful` — an improvement, with no criterion
change.**

> v1: "a core, everyday sense of a **very frequent** English word... foundational
> and useful"
> v2: "a basic, everyday sense of a very common word... **not** a concept an adult
> building a professional or academic vocabulary would specifically need to learn"

That is the tier-1 reasoning finding 3 said needed a clause. It arrived without
one, which suggests promoting frequency from a header line to a labelled evidence
item is what made it usable.

**`Texan`'s adjective sense flipped to `useful` — a regression.** The rationales
differ in kind, not just verdict. Version 1 reasoned about the category: "such
vocabulary typically consists of abstract, technical, or cross-disciplinary
terms". Version 2 walked the list: "The definition identifies... The part of
speech is adjective, and although the frequency is...".

**Hypothesis, held loosely at n=2:** numbering makes the judge more
evidence-driven and less holistic. That helps where the evidence is decisive and
hurts where the call needs a category read the evidence does not state. Not
believed until a larger set says so.

Mitigating: `Texan` is removed by the deterministic demonym filter before this
gate. The golden set carries it as defence in depth, so the regression costs less
than the score implies.

### The fold now demonstrably blocks tier-1 rejection

`happy` is `not_useful, useful, useful, useful` and **still advances**, because
any `useful` keeps the word. Rejecting a tier-1 word requires every sense to
flip. This was raised as a hypothetical at the checkpoint and is now observed.
The owner's call stands — fold as-is for now — but it is a real constraint on
what a criterion clause can achieve alone.

### Operations

| | v1 | v2 |
|---|---|---|
| Cost | `$0.002358` | `$0.003280` (+39%) |
| Completion tokens | 9,964 | 14,879 |
| of which reasoning | 7,384 | **12,649** (+71%) |
| Latency, median | 10,562 ms | 8,359 ms |
| Legal citations | 44% | **100%** |

More reasoning, more cost, lower wall-clock latency.

## Decision

**No conclusion about v2 being better or worse.** One flip in each direction
across twelve cases is 8.3% per case; this is the noise the plan warns about, and
9 against 10 is not a result. What v2 bought is structural and not in dispute:
citations that work, and visibility into which evidence carries a verdict.

Braintrust experiment names now carry the configuration — case set, prompt
version, contract version, model, upstream — because `usefulness-golden-v1` is
the *dataset* version and two runs under different prompts were colliding under
one name.

Next is the model bake-off, on this contract, with the model as the only
variable.

---

# Stage 3c: model bake-off

## Pre-run record

**Question.** Which model should the usefulness gate run on, given that
`deepseek-v4-flash` spends three quarters of its completion budget on hidden
reasoning and answers in eight and a half seconds?

**Changed variable.** The model, and only the model. Contract
`usefulness-finding/2`, prompt `usefulness-prompt/2`, dataset
`usefulness-golden/1`, temperature 0, all held constant. Every upstream pinned.

**Candidates.** The incumbent, plus two scale candidates and one quality
reference. `mistral-small-24b` was excluded despite the cheapest output price:
it has exactly one upstream, and a single-upstream model is how `morph/bf16`
denied the stage 3 baseline twice.

**How this is read.** In priority order: contract compliance, then cost and
latency, then disposition agreement as a tiebreak only. Twelve cases labelled by
one person cannot rank taste, and any conclusion drawn from a one-case
difference would be noise.

**Expected spend.** Roughly `$0.025` across three models, gemini most of it.

## Results

Fifty-seven calls, three models, no repairs.

| Model | Upstream | Disposition | Contract failures | Keeps lost | $/call | Latency (med) | Completion tokens |
|---|---|---|---|---|---|---|---|
| `google/gemini-2.5-flash` | `google-ai-studio` | 9/12 | 0 | 0 | `$0.000376` | **1,012 ms** | 2,030 |
| `deepseek/deepseek-v4-flash-0731` | `deepinfra/fp8` | 9/12 | 0 | 0 | `$0.000173` | 8,359 ms | 14,879 |
| `qwen/qwen3-30b-a3b-instruct-2507` | `coreweave/bf16` | 8/12 | 1 | 0 | **`$0.000098`** | 2,849 ms | 3,944 |
| `openai/gpt-oss-120b` | `deepinfra/bf16` | 5/12 | **9** | **3** | `$0.000062` | 6,531 ms | 5,269 |

### Finding 1: the same two words fail on every model

`herbivorous` and `happy` are wrong under all four judges. Nothing else is
consistent — `pinnate` fails on gemini and qwen but not deepseek, `Texan` fails
on deepseek and qwen but not gemini.

That is much stronger evidence than the baseline could give. Those two are not a
model weakness; they are the criterion not saying what the owner means. Findings
3 and 4 are now confirmed across four independent judges, which is close to the
best evidence available at this scale. Everything else is the noise floor, and
the 8-versus-9 spread should be read as exactly that.

### Finding 2: `gpt-oss-120b` fails the contract in a way only the identity check catches

Nine of nineteen replies came back with the **verdict in the identifier field**:

```json
{"sense_id": "useful", "usefulness": "useful", "rationale": "The definition (E1) …"}
```

The strict JSON schema is fully satisfied — `sense_id` is a string, and a string
is what was asked for. Nothing about the shape is wrong. Only
`ContractMeaningIdentity` catches it, and that is the scorer this stage nearly
retired as redundant on the grounds that the provider guarantees the schema.

The lesson generalises: a schema constrains shape, never meaning. Every field
whose *content* must correspond to the input needs its own check.

Downstream, those failures became three lost keeps — `ubiquitous`, `equivocate`
and `laconic` quarantined — because a headword whose meanings produced no valid
finding cannot be advanced by the fold.

`qwen` failed once, differently and benignly: it truncated
`oewn-texan__3.01.00..` to `oewn-texan__3.01.00`, dropping the trailing dots.

### Finding 3: contract v2 priced the incumbent out of a full-pool run

The reasoning-token increase measured in stage 3b carries straight into scale.
Against the Zipf 1-4 band, 75,283 calls:

| Model | Zipf 1-4 |
|---|---|
| `qwen3-30b-instruct` | `$7.38` |
| `deepseek-v4-flash` | `$13.02` |
| `gemini-2.5-flash` | `$28.31` |

Only qwen fits what is left of the `$10` cap. The incumbent no longer does.

Note the shape of gemini's cost: it emits 107 completion tokens per call against
deepseek's 783, a 7x concision advantage, and still costs 2.2x more because its
per-token price is 14x higher.

## Decision

**Switch to `google/gemini-2.5-flash` via `google-ai-studio`, and defer the scale
choice.**

Cost is not the binding constraint for anything in the near term — the retention
audit, an exploration draw and several prompt iterations together come to well
under `$0.50` on any of these models. Iteration speed is. At 1,012 ms a
nineteen-call run finishes in about twenty seconds rather than three minutes, and
exploration draws are ten to twenty times that size. Zero contract failures, and
it is the model stage 2 already validated end to end.

The scale decision is deliberately postponed until the prompt has settled and the
deterministic filters — #59, the demonym rule, the frequency band — have cut the
call count. Choosing a production model against a prompt that is still moving
would be settling the wrong variable first.

**`openai/gpt-oss-120b` is disqualified**, not ranked. A model that puts the
verdict in the identifier field half the time cannot be trusted with a contract
whatever it costs.
