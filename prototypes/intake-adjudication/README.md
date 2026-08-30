# PROTOTYPE — intake adjudication, issue #46

Throwaway. No schema, no migrations, no pipeline integration. The plan is
[`docs/plans/intake-adjudication-evaluation.md`](../../docs/plans/intake-adjudication-evaluation.md),
and its `## Revision` section at the top is authoritative — read that before
anything below it.

## Two gates

Since stage 2, **audience usefulness is the word-selection gate** and morphology
is content preparation with no `exclude` path. They ask different questions of
different subjects and share no rubric, contract, policy or labels.

| | Morphology (#46, #49) | Audience usefulness (#56) |
|---|---|---|
| Question | Is the word built the way the mechanical rule claims? | Is this meaning worth learning for an adult building a professional and academic vocabulary? |
| Subject | A mechanical claim | One source meaning |
| Authority | A lexicographer could settle it | The product owner alone — the ceiling is their own self-agreement |
| Endorsement | Overrides a fuzzy exclusion | Decides nothing; it is the retention audit's sample |
| Modules | `src/morphology/` | `src/usefulness/` |

What they share is `src/gate.ts` and everything behind it: one path that calls a
model, one config fingerprint, one spend guard against the shared $10 cap. A
gate supplies what to send, how to read the reply and how policy decides;
`adjudicate` supplies the rest. A second copy of the runner is how an experiment
ends up measuring a prompt that is not the one under test.

The mechanical intake rules from spike #44 fail in one specific way: **they
invent word formation that does not exist.** `rebut` is not `re` + `but`,
`pastoral` is not `past` + `oral`. Roughly 12,700 headwords carry at least one
such claim. This prototype asks a model to adjudicate each claim against fixed
lexical evidence, and lets deterministic policy — never the model — decide what
happens to the word.

## Morphology's unit of judgment

A **mechanical claim**, not a headword:

```text
headword + rule kind + proposed root or components
```

One word may carry several claims and each is judged separately, so a valid
claim cannot hide a bogus one on the same word. Within a claim, every source
meaning is judged separately, so a predictable sense cannot hide one that
teaches something new.

## The four layers, kept apart

| Layer | Where it lives | What it may decide |
|---|---|---|
| Mechanical attributes | `pool.sqlite`, spike #44 | which claims exist |
| Judge findings | `src/contract.ts` | analysis support, per-meaning predictability |
| Endorsement | `policy_context` on each claim | overrides a *fuzzy* exclusion, nothing else |
| Effective disposition | `src/policy.ts` | advance, quarantine, exclude |

Endorsement never reaches the prompt. It says an editor found a word worth
teaching, which is evidence about interest, not about whether a proposed
decomposition is true. It also stays out of the accuracy labels, so it can serve
as an independent retention audit.

Model self-confidence never reaches the policy. `deriveMorphologyDisposition`
takes two fields and `verdictOf` is the only way to produce them, so
`diagnostic_confidence` is structurally unreachable rather than merely unused.

## Files

| File | What it does |
|---|---|
| `src/gate.ts` | what every gate has in common: versions, schema, parse, decide |
| `src/disposition.ts` | advance / quarantine / exclude, shared so downstream never depends on which gate spoke |
| `src/parse.ts` | JSON, schema and subject-identity checks, shared by both contracts |
| `export_evidence.py` | scratch pool + pinned OEWN → versioned JSONL claims, with explicit missing-evidence markers |
| `export_usefulness_evidence.py` | the same, for the usefulness gate: one record per source meaning |
| `sample_retention_audit.py` | draws the 100-word unlabelled retention audit, seeded and reproducible |
| `src/usefulness/` | the usefulness gate: subject, contract, prompt, policy, fan-out runner |
| `cases/*.claims.json` | which claims to materialise, and why those |
| `evidence/*.claims.jsonl` | the fixed evidence a judge sees. Committed, so a run is reproducible |
| `evidence/*.manifest.json` | pinned source releases, digests, and per-claim input digests |
| `labels/*.labels.jsonl` | expected verdicts, each carrying its `label_status` |
| `src/contract.ts` | the output contract; one zod schema serves both the validator and the provider's strict JSON schema |
| `src/prompt.ts` | versioned rubric and claim rendering |
| `src/adjudicate.ts` | the shared runner used by both the CLI and the eval |
| `src/policy.ts` | versioned deterministic policy, plus the endorsement override |
| `src/review-cli.ts` | generates the dependency-free local calibration review page |
| `src/fingerprint.ts` | the config fingerprint that keys persistence |
| `src/store.ts` | one JSON record per fingerprint, under `runs/` |
| `src/budget.ts` | spend guard against the $10 pilot cap |
| `evals/contract.eval.ts` | the Braintrust experiment |
| `evals/scorers/` | contract, semantic and policy scorers, all deterministic |

## Setup

Credentials first, and read this before creating any:

- Use a **project-specific prepaid OpenRouter key with auto-recharge off**, not
  an account-wide key. The pilot budget for all of #46 is **$10**.
- Keys go in `.env.local` and nowhere else. Never in a chat message, a shell
  command, a commit, an issue, a Braintrust trace, or a dataset.

```sh
npm install
./setup-credentials.sh       # guided: creates both keys, writes .env.local
```

The wizard opens each page, says what to click, hides key entry, refuses a key
with no credit limit, and finishes with a dry run that costs nothing. To do it
by hand instead, `cp .env.example .env.local` and fill it in, then:

```sh
npm run models               # current model identifiers and prices
npm run models -- <model-id> # the upstreams serving it; pin one
npm run adjudicate -- --dry  # estimate and budget check, no calls
```

Regenerating the evidence needs the spike #44 environment, because the pinned
OEWN release is 107 MB and is not committed:

```sh
cd ../content-pipeline-source-shapes
./venv/bin/python ../intake-adjudication/export_evidence.py \
  --cases ../intake-adjudication/cases/contract-test.claims.json \
  --out   ../intake-adjudication/evidence
```

## Running

```sh
npm test          # policy, contract and runner tests. No network, no spend
npm run typecheck

npm run adjudicate        # morphology: the five contract-test cases
npm run eval              # the same five as a Braintrust experiment

npm run usefulness        # usefulness: 19 meanings across the golden 12
npm run usefulness -- --dry
npm run eval:usefulness   # the same twelve as a Braintrust experiment
```

## The retention audit

`cases/retention-audit-v1.json` is 100 endorsed headwords, drawn by proportional
allocation within strata (endorsement band, frequency band, part of speech) at a
recorded seed. It reports exactly one number — the share the usefulness gate
keeps — and three properties make it worth having:

- **Unlabelled.** Nobody assigns a verdict. Labelling it makes it a second golden
  set with all the problems the first was cut down to avoid.
- **Disjoint** from every golden case. Endorsement can seed golden cases *or*
  serve as the audit, never both on the same words.
- **Never tuned toward.** A drop in retention is a question, not a target.

`evals/retention-audit.test.ts` asserts all three rather than trusting them.

## Local calibration review

Generate a self-contained page containing only the 12 human-review members frozen in
`cases/calibration-v1.partitions.json`:

```sh
npm run review:build
open review/calibration-v1.html
```

If `labels/calibration-silver.labels.jsonl` (or the explicit
`calibration-silver.provisional.jsonl` variant) exists, the generator includes
its `provisional-unvalidated` semantic labels. Override that path with
`npm run review:build -- --labels path/to/labels.jsonl`, or use `--no-labels`.
Use `--out path/to/page.html` to change the generated page location.

The page stores noncanonical working state in `localStorage`, keyed by partition
version, evidence digest, rubric version, and each claim's input digest. Export
progress regularly if review spans browsers or machines; progress JSON can be
imported only by a page with the same fingerprints. "Export validated JSONL"
emits canonical, claim-ID-sorted records only for complete accepted or corrected
decisions. Uncertain and incomplete cases are omitted. The generated HTML,
progress snapshots, and local exports are ignored; intentionally reviewed JSONL
must be moved into `labels/` before it becomes canonical project data.

Endorsement and its deterministic policy effect stay hidden until all semantic
fields have been decided. They are policy context, never evidence for the
semantic judgment.

Both paid paths refuse to start when the estimate exceeds what is left of the
pilot cap, and both reuse a persisted record when the configuration is unchanged.

## What is deliberately absent

- **No repair retry.** Transport failures are retried by the SDK because they
  say nothing about the model. Malformed or contract-violating output is
  recorded and scored as the failure it is. A repair attempt is a separate later
  experiment with its own accuracy, latency and cost to measure.
- **No response caching during reliability runs.** Persistence under a config
  fingerprint prevents paying twice for the same question. Braintrust's response
  caching is a different tool, useful while iterating on prompt text and wrong
  when measuring repeated-run consistency, where it would manufacture agreement.
- **No unpinned runs.** `OPENROUTER_PROVIDER` is required. The same model is
  served by 22 upstreams at prices spanning 14x, and stage 1 measured two
  different verdicts under one fingerprint when routing was left free.
- **No root validation in the extractor.** OEWN records no derivation link from
  a participial adjective to its base verb, so there is nothing to validate
  against. The extractor casts a wide net and adjudication rejects the
  coincidences, which is what the gate is for.
- **No composite score.** A model clears correctness and retention first;
  ranking among those that qualify comes later.
