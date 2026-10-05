# Private appropriateness evaluation

Implemented for [issue #15](https://github.com/cwebley/word-well/issues/15).
It runs a frozen encrypted appropriateness set through the shared stage and
executor, three trials per case, and saves encrypted results and scores in
local PostgreSQL. Tests use harmless fixtures and scripted replies only. Live
runs began on 2026-10-04, after the owner verified provider privacy and
pricing. The pieces of #16 the owner pulled forward are also here: the local
report, finalize, and aggregate export.

The [saved-results and restore walkthrough](private-results-and-restore.md)
explains those commands, their failure paths, and the completed #16 rehearsal.

```text
evals/datasets/appropriateness-v000001 (age, dataset key)
        │ loadFrozenDataset
        v
evals/private-appropriateness.ts ── expectation ──> evals/scorers/appropriateness.ts
        │ exact headword only           (dataset key)       │ case score (dataset key)
        v                                                   v
pipeline/stages/appropriateness.ts      ┌────────── private.case_scores
  questions, renderer, validation,      │
  thresholds, three-trial average       │
        │                               │
pipeline/execution/executor.ts ─────────┤ private.experiments, cases, trials,
  reserve -> intent -> send ->          │ attempts, requests (age, storage key)
  outcome -> save -> validate           │
        │                │
        │                └─> receipts.jsonl (accounting only, outside the checkout)
        v
pipeline/execution/system-one.ts ──> POST https://openrouter.ai/api/v1/systemone
```

## Decisions this slice relies on

The owner [approved four implementation choices](https://github.com/cwebley/word-well/issues/15#issuecomment-5986949593)
that #15 left open:

1. **Transport.** The AI SDK cannot call `/api/v1/systemone`, so the adapter
   is a small `fetch` client. `fetch` never retries; the executor owns every
   retry. It keeps the raw body, status and `Retry-After` exactly.
2. **Database.** A named Docker volume. A `private` schema inside the app
   databases with its own migrations directory. Tests create and drop a
   throwaway database. The `wordwell_learner` role has no access to `private`.
3. **Validation.** Exact pinned model; exactly `clear` and `blocked`; each
   probability in [0, 1]; sum within ±0.011 of 1; confidence in [0, 1]. A
   `choice` more than one rounding step away from the probabilities is invalid.
   Policy reads the blocked probability and any yes/no question probabilities.
4. **Reservations.** Each request reserves 32,000 context tokens × the
   per-input-token price. [Pricing was verified](https://github.com/cwebley/word-well/issues/15#issuecomment-5987768473)
   at 42 nano-USD per input token. `run`/`resume` refuse while
   `config/private-appropriateness.json` marks pricing `unverified`.

Later owner decisions on #15:
[the slur-sense question](https://github.com/cwebley/word-well/issues/15#issuecomment-5988530191),
[default `v4`, names, and one-step authoring](https://github.com/cwebley/word-well/issues/15#issuecomment-5989103199),
and [the no-wrong-accepts pass rule](https://github.com/cwebley/word-well/issues/15#issuecomment-5989305376).

## Configurations

Named configurations live in `pipeline/stages/appropriateness.ts` and run on the
same frozen inputs with `--configuration <name>`. Names are labels only: each
experiment saves the full material and its fingerprint.

| Name | What it is |
| --- | --- |
| `v1` | Original #12 wording, one question |
| `v2` | Every-sense wording that names slur senses |
| `v3` | `v2` plus the `slur_sense` yes/no question |
| **`v4`** (default) | `v3`, genital and sexual-act terms excluded from the anatomical exemption, slur threshold 0.40 |
| `v1-slur-check`, `v3-lookalike`, `v4-vulgar-check` | Tried, not adopted |

A trial rejects when any asked question reaches its threshold: 0.50 for the
main question, 0.40 for `v4`'s slur question. The three-trial verdict averages
each question unrounded, then applies the same thresholds.

**Pass rule: no wrong accepts.** All three trials must be valid, and no trial
and no average may wrongly accept a blocked word. Wrong rejects are counted,
shown, and tolerated. `status`, the report and `finalize` rescore saved trial
outcomes under this rule, with zero model calls.

## Keys

The evaluator loads both Keychain identities. The storage key encrypts stage
inputs, requests, raw replies, results and experiment material. The dataset key
encrypts owner expectations, reasons and splits copied into `private.cases`, and
per-case scores, because a score reveals the expected finding. The executor never
reads expectations, and a store opened without the dataset key, as a future
production coordinator would use, gets `dataset_key_required` if it asks for
expectations or scores. The evaluation CLI opens one store with both keys. A missing
or mismatched key stops before any database work, decryption or dispatch.

## Local setup

Requires the authoring setup from [private-authoring.md](private-authoring.md)
(two Keychain identities and `keys.json`) and Docker.

```sh
docker compose up -d --wait
DATABASE_URL=postgresql://wordwell:wordwell@127.0.0.1:54329/wordwell_dev npm run db:migrate
```

The compose volume `wordwell-postgres` holds `wordwell_dev` (durable private
history) and `wordwell_test` (API suites). `db/postgres-init/` creates
`wordwell_dev` only when the volume is first initialized.

Commands (the npm scripts load `OPENROUTER_API_KEY` and `BRAINTRUST_API_KEY` from `.env`):

```sh
# Evaluate. Each run is a fresh experiment; earlier ones never change.
npm run eval:private -- run --dataset appropriateness-v000007 --split development --max-cost-usd 0.25
npm run eval:private -- run --dataset appropriateness-v000007 --split held-out --configuration v4 --max-cost-usd 0.25
npm run eval:private -- resume <experiment-id>     # continue an interrupted run
npm run eval:private -- status <experiment-id>     # counts only, zero calls

# Inspect per-word results on 127.0.0.1 (zero calls).
npm run eval:private:report

# Freeze an experiment's aggregate summary, then upload one Braintrust row.
npm run eval:private -- finalize <experiment-id>
npm run eval:export -- --summary "$HOME/Library/Application Support/WordWell/private-evaluation/summaries/<experiment-id>.json"

# Harmless live checks: 5 smoke words, or 344 public usefulness words.
npm run eval:private:smoke
npm run eval:private:audit -- --configuration v4
```

`run` requires `--split development`, `--split held-out` or `--split all`, so
held-out words are never sent by default. Terminal output is counts and amounts
only, except smoke and audit, whose words are public. Use `--split held-out` once per configuration you mean to report.
After inspecting held-out words and tuning on them, move them to development
in the next dataset version and add fresh held-out words.

## Files

| File | Responsibility |
| --- | --- |
| `pipeline/stages/appropriateness.ts` | Named configurations, headword-only renderer, validation, thresholds, average, configuration identity |
| `pipeline/execution/stage.ts` | What the executor needs from any stage |
| `pipeline/execution/model.ts` | Model adapter interface: send, accounting, classify |
| `pipeline/execution/system-one.ts` | OpenRouter System One adapter |
| `pipeline/execution/executor.ts` | Attempt lifecycle, reservations, retries, recovery |
| `pipeline/storage/postgres.ts` | Encrypted PostgreSQL records and atomic reservations |
| `pipeline/storage/receipts.ts` | Append-only accounting ledger |
| `evals/trials.ts` | Experiment/case/trial to attempt mapping |
| `evals/scorers/appropriateness.ts` | Per-trial, averaged and summary scoring |
| `evals/private-appropriateness.ts` | Read-only reader (status, per-case results, saved configuration) and the runner (create, run/resume, finalize) |
| `evals/private-appropriateness-cli.ts` | Command line, smoke and audit runs, printing. Outside the implementation identity |
| `evals/private-local.ts` | Local keys, database and private directories shared by the CLI and the report |
| `evals/private-report.ts` | Read-only loopback report: per-word trials, mistakes, comparison |
| `evals/summarize.ts` | Strict aggregate-only summary allowlist |
| `evals/export-summary.ts` | Separate Braintrust exporter: summary file and key only |
| `db/private-migrations/001_private_evaluation.sql` | Private schema, learner-role isolation |
| `db/private-migrations/002_finalization.sql` | Finalized-at and summary digest |
| `config/private-appropriateness.json` | Execution settings and verified pricing |

## Verification

```sh
npm run typecheck
docker compose up -d --wait
DATABASE_URL=postgresql://wordwell:wordwell@127.0.0.1:54329/wordwell_test npm run test:private
WORDWELL_TEST_KEYCHAIN=1 npm run test:authoring
```

`test:private` refuses to start without `DATABASE_URL`, so it cannot pass by
skipping. Under plain `npm test` the database suites skip without it, like the
API suites. CI runs `test:private` against its PostgreSQL service.

## Behavior on failure, restart and resume

| Situation | What happens | What persists |
| --- | --- | --- |
| HTTP 408/429/500/502/503/504, or that code inside an HTTP 200 error body | Retry after the longer of the configured delay (2 s, 8 s) and `Retry-After`; at most three physical requests | Each request row, raw reply, unknown charge |
| Required wait over 60 s | Pause `retry_deferred` with the next eligible time; resume continues from the durable count | `next_eligible_at`; retry allowance never resets |
| HTTP 400/401/402/403/404/413/422, or a provider error body | Failed trial (`request_rejected`, `credentials_rejected`, `insufficient_credits`, `provider_error`) | Raw reply |
| Malformed, wrong model, wrong answers, bad distribution | Invalid trial, no verdict, run stops. No repair call | Raw reply |
| Timeout or connection loss | Uncertain trial, reservation kept, run stops. Never redispatched | Request row `no_response`, unknown charge |
| Reservation would exceed the cap | Pause `budget_exhausted` before dispatch | Nothing sent |
| Dispatch intent cannot be written | Reservation abandoned, pause `accounting_unavailable` | Nothing sent |
| Outcome receipt cannot be written | Reply saved in PostgreSQL, pause `accounting_unavailable`; resume restores the receipt before anything else | Charge in PostgreSQL |
| PostgreSQL write fails briefly | Retried twice with the reply in memory, no new call | Normal records |
| PostgreSQL stays down after a reply | Pause `storage_unavailable`; resume imports the ledger charge and marks `response_lost` | Ledger charge, visible failure |
| Process killed in flight | Resume finds the intent without an outcome: uncertain, never redispatched | Reservation kept |
| Process stopped after saving the reply, before the verdict | Resume re-validates the saved reply, no new call | Normal records |
| Resume after an invalid or failed trial | Kept as saved; the run continues with the remaining trials | Old evidence unchanged |
| Changed implementation files | `implementation_changed`; resume refuses, no call | Nothing |
| Second runner on one experiment | `experiment_busy` (session advisory lock, released when a process dies) | Nothing |

Unknown charges keep their full reservation committed against the cap until a
later reconciliation can price them.

## Walkthrough of a harmless trace

Generated by running the real runner, executor, store and ledger against a
throwaway database with scripted replies, before `v2`–`v4` existed. It uses the
single-question `v1` request. These are fixtures, not Jev results.
Cases: `exuberant` (stand-in expectation clear) and `harmless-blocked-standin`
(stand-in expectation blocked).

1. **Create.** `runner.create` decrypts the frozen dataset with the dataset
   key and writes one `private.experiments` row: stage `appropriateness`,
   dataset version 1, configuration fingerprint `26950a69eecf…`,
   implementation fingerprint, cap 500,000,000 nano-USD, and a 2,356-byte
   storage-key payload with the configuration, execution settings, pricing and
   dataset content identity. Two `private.cases` rows: input under
   `ww-storage-v1`, expectation under `ww-dataset-v1`. No model call.
2. **Trial 1 of `exuberant`.** `trials.ts` assigns a fresh attempt ID. The
   stage renders `{"model":"typesafe/jev-1.13","state":"exuberant","questions":{"appropriateness":…}}`.
   The executor reserves 1,344,000 nano-USD (32,000 × 42), writes a
   `dispatch_intent` receipt, and sends. The scripted reply is HTTP 429 with
   `Retry-After: 3`: request row 1 is `responded`, `retryable`,
   `retry_after_ms 3000`, charge `unknown`. It waits 2,988 ms (3 s from the
   reply) and sends request 2, which returns `clear 0.93 / blocked 0.07`, cost
   17,304 nano-USD. The attempt is `valid` with disposition `accept`, and the
   raw reply is saved encrypted.
3. **Recovery.** One PostgreSQL write was made to fail once. The executor waited
   250 ms and retried it with the reply in memory. Requests stayed at six.
4. **Rejection.** `harmless-blocked-standin` trial 1 returns `blocked 0.91`, a
   valid finding with disposition `reject`. A gate rejection is a result, not
   a failure.
5. **Failure.** Trial 2 returns `{truncated`. The attempt is `invalid`
   (`malformed_reply`) with no verdict, and the run stops with
   `{"state":"invalid","code":"malformed_reply"}` after six requests.
6. **Resume.** `run` again keeps trial 2 as saved, sends one request for
   trial 3 (`blocked 0.88`), and finishes. Summary: 5 valid, 1 invalid, 0
   missing; `exuberant` passes (average 0.0767, all three correct);
   the stand-in fails because an invalid trial blocks a pass;
   `goldenRequirementsPass: false`. Spend: known 86,520 nano-USD, 2 unresolved
   requests (the 429 and the malformed reply) holding 2,688,000 nano-USD of
   reservation, 7 physical requests. `status` returns the same summary with
   zero calls.
7. **Ledger.** Fourteen events: seven intents and seven outcomes, with only IDs,
   HTTP codes, token counts and amounts.
8. **Future configuration.** A second experiment with pinned model
   `typesafe/jev-1.14-20270101` gets a new fingerprint (`a117be34783d…`) and
   the same dataset ID. It sends a byte-identical request body. The scripted
   provider still answers 1.13, so the first trial is `invalid` (`wrong_model`).
   The incumbent's evidence is untouched.

What the trace exposed: every unpriced error permanently consumes one full
reservation of cap (about $0.0013 here) until reconciliation can price it, so a
noisy provider shrinks the usable budget faster than its real charges.
