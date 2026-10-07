# Durable usefulness through both gates

The #26 coordinator runs through usefulness and stops for inspection. The
controlled trace uses the saved ready `emulate` bundle in disposable databases.
It does not establish a live judgment, lesson plan, written lesson or publication.
Appropriateness promotion still requires the owner's explicit decision in #17.

```text
selected ready bundle -> current passing intake -> candidate claim
                                                   |
                                      appropriateness, three trials or reuse
                                         reject/fail -> stop
                                                   |
                                      current selected acceptance
                                                   |
                                      usefulness, three trials or reuse
                                                   |
                                      select + authorize + stop for inspection

frozen usefulness evaluation -> same stage/executor -> encrypted attempts
                                                     -> score saved answers
                                                     -> no production selection
```

## Files and boundaries

| File | Input, result and persistence |
| --- | --- |
| `pipeline/sources/index.ts` | Current passing intake returns `{ headword: "emulate", partsOfSpeech: ["v"] }` from the selected candidate's OEWN entries. Linked contrast/family entries and Wiktionary-only POS are excluded. The recorded OEWN POS representation matches the measured input |
| `pipeline/stages/usefulness.ts` | `createUsefulnessStage` renders the nine measured questions and headword/POS state. It calls the existing `validateAnswer`, including rounded-choice tie handling. `combineTrials` retains the learned scoring formula and averages features before applying the cutoff |
| `pipeline/production-config.ts` | Fixed run instructions retain both stage inputs/configurations, stage-specific reuse identities, original source selection, intake, implementation and execution/pricing material |
| `pipeline/run.ts` | Claims the candidate, orders gates, stops on rejection/failure, selects valid aggregates and appends current authorizations. It verifies saved raw trials before authorizing downstream work. The first usefulness attempt freezes its original appropriateness/intake dependencies; resume retains them |
| `pipeline/reuse.ts` | Appropriateness remains headword-only. Usefulness binds headword, recorded POS, request/configuration, interpretation files and the selected source bundle. Changed intake alone rechecks permission. A different bundle requires fresh usefulness because cross-release correspondence has not been verified |
| `pipeline/execution/executor.ts` | Both production and evaluation use the existing request lifecycle, retry limits, encrypted request/reply storage, ownership transactions and accounting ledger. Attempt provenance is optional and retained with frozen input |
| `pipeline/storage/postgres.ts` | Both gates use existing attempts, requests, results, selections/history and authorizations. Authorizations record the current appropriateness result separately from usefulness's original dependency |
| `db/private-migrations/008_durable_usefulness.sql` | Additive stage-qualified trial/result identities and multi-stage authorizations. Prior rows retain their appropriateness stage. The existing promotion table admits usefulness's external authority separately from appropriateness assessments |
| `db/private-migrations/009_append_gate_authorizations.sql` | Appends distinct current authorization identities when intake, promotion or preceding acceptance changes during a pause. Exact duplicate authorizations remain idempotent |
| `pipeline/usefulness-promotion.ts` | Loads the existing #11 owner decision, with pinned artifact/configuration digests. It checks that original weights remain unchanged and the promoted 0.58 selection has a distinct ID. It neither assesses nor promotes appropriateness |
| `evals/durable-usefulness.ts` | Direct frozen-stage evaluation uses the same stage, executor, trial mapping and encrypted store. POS input uses the storage identity; expectations use the dataset identity. Resume preserves completed trials, including invalid trials. Inspection scores saved outcomes and sends no request |
| `scripts/replay-durable-usefulness.ts` | Compares the durable validator/scorer against a saved promoted experiment. It blocks network, reports aggregate counts and checks that baseline/answer bytes remain unchanged |

The fixed model is `typesafe/jev-1.13`, with replies pinned to
`typesafe/jev-1.13-20260917`. Definitions, examples, frequency, source labels,
endorsements and owner expectations never enter the gate request. The original
`config/usefulness-combiner-e9d29c215805.json` remains at 0.50. Production uses
`config/usefulness-combiner-effc8eb93ba0.json` at 0.58.

## Actual controlled normal trace

`pipeline/run.test.ts` reads development's ready bundle
`33151aac5fdc58d06266eba9a6071adf9f9def58b64ec96d622dbe891c3f7e78`, then copies
its evidence into unique disposable databases. It uses restricted logins,
in-memory test keys and scripted replies. All request counts below count those
scripted requests, not live provider calls.

1. `buildScopedCandidate` reproduces passing intake at direct Zipf 3.41.
   `authorizeScopedCandidate` projects `emulate` for appropriateness and `emulate`
   with recorded POS `v` for usefulness. Source evidence and intake persist;
   no request is sent.
2. `createProductionCoordinator.create` saves fixed instructions and a cap of
   100,000,000 nano-USD. `run` obtains the candidate claim. Three scripted
   appropriateness replies have main/slur probability 0.1. The aggregate accepts.
   Three encrypted attempts/raw replies persist, with known spend 51,912 nano-USD.
   Selection/history and authorization commit through the owning connection;
   the claim stays held for usefulness.
3. The usefulness request state is exactly:

   ```text
   HEADWORD
   word: emulate
   recorded parts of speech: v
   ```

   The scripted `prior_recognition` scores are 1.75, 1.8 and 1.85. Other answers
   come from `pipeline/testing/usefulness-fixtures.ts`. Each reply costs 84,000
   nano-USD. The test checks exact rendered requests against the shared stage,
   three-trial averaged features and learned keep score. The averaged verdict is
   `advance`. The immutable result records all three attempts and the original
   appropriateness result/intake assessment. Current authorization is a separate
   row. Both gates together make six requests and cost 303,912 nano-USD.
4. An unchanged normal run reuses both results. It appends two authorizations,
   sends zero requests and preserves the original result material.
5. An appropriateness-only fresh acceptance sends three requests. A subsequent
   normal run reuses unchanged usefulness with zero requests. Its authorization
   names the new acceptance, while the usefulness result and attempts still name
   the acceptance under which they were created.

These are orchestration fixtures, not claims about Jev's judgment of `emulate`.

## Evaluation, rejection, failure and rerun

- The direct evaluation fixture has frozen `emulate`, POS `v`, and stand-in
  expected `keep`. `evals/durable-usefulness.ts` creates a separate experiment and
  three trial identities. It makes three scripted requests without production
  intake or promotions, scores the averaged result and writes no production
  selection. A repeated run reads its three saved outcomes with zero new calls.
  A newly invalid or failed trial stops dispatch. Deliberate resume keeps that
  failure and continues with the remaining trial identities; it never replaces
  the failed answer or turns the incomplete case into a pass.
- A fresh-all appropriateness failure stops after one malformed reply. It has
  no verdict and preserves both earlier selections. A fresh rejection sends three
  appropriateness requests and stops before usefulness. A later normal run
  reuses the selected rejection with zero requests.
- A usefulness-only run requires current selected appropriateness acceptance.
  It never fills missing prerequisites implicitly. A malformed usefulness
  answer fails after one request and preserves the earlier usefulness selection.
  A fresh valid 1.9 recognition fixture falls below 0.58, selects `exclude` and
  stops. A later normal run reuses that exclusion at zero cost.
- A fresh-all run paused after usefulness's first reply retains its candidate
  claim. A competing command cannot start. Resume restores accounting and
  completes the remaining trials without repeating completed appropriateness.
- A usefulness network failure has unknown spend, no verdict and no selection.
  Its 1,344,000 nano-USD reservation remains outstanding. Recovery and resume
  never redispatch it. Known charges can reconcile later without inventing an
  answer.
- Both gates inherit the verified pre-send cancellation, lost-lock fencing,
  encrypted terminal writes, storage retry, response-lost and late-accounting
  behavior in [production appropriateness](production-appropriateness.md).

The trace exposed a resume detail: completed appropriateness is now an
intermediate checkpoint, not the terminal run outcome. Fresh-all must recognize
that checkpoint after a usefulness pause. Otherwise it would either pay again
or collide with the immutable gate-result identity.

## Commands

```sh
npm run db:migrate
# Load the already recorded #11 decision. Zero calls, idempotent.
npm run --silent pipeline -- promotion record-usefulness
npm run --silent pipeline -- run --candidate emulate --bundle <ready-bundle-id> --dry-run
npm run --silent pipeline -- run --candidate emulate --bundle <ready-bundle-id> --max-cost-usd <cap>
npm run --silent pipeline -- run --candidate emulate --bundle <ready-bundle-id> --fresh-all --max-cost-usd <cap>
npm run --silent pipeline -- run --candidate emulate --bundle <ready-bundle-id> --stage usefulness --fresh --max-cost-usd <cap>
npm run --silent pipeline -- inspect <run-id>
npm run --silent pipeline -- recover <run-id>
npm run --silent pipeline -- resume <run-id>

# New direct evaluation, only with an explicitly authorized budget.
npm run eval:usefulness -- --dataset <frozen-dataset.json> --jev live --max-cost-usd <cap>
npm run eval:usefulness -- --resume <experiment-id>
npm run eval:usefulness -- --inspect <experiment-id>

# Saved historical evidence, zero calls and no rewriting.
npm run eval:usefulness:replay-check -- --baseline <saved-promoted-experiment.json> --answers <saved-answers.json>
```

Normal live dispatch checks recorded promotions and an explicit cap. The CLI has
no controlled-execution bypass. Loading #11's decision does not provide #17's
missing owner decision. Dry-run, inspection, recovery and saved replay make zero
generation calls. Resume preserves the original cap and configuration. Private
inspection output includes decrypted replies and expectations.

New usefulness evaluations retain encrypted history in PostgreSQL and
accounting-only receipts under
`~/Library/Application Support/WordWell/usefulness-evaluation/ledger`.
Historical replay files remain readable; new paid evaluations use the shared
executor rather than the old file-writing HTTP client.

## Saved replay evidence

The accepted reviewed-sample experiment
`2026-10-01T21-30-00-487Z-7f34d07a` was replayed without network. All 110 cases,
330 trial scores/verdicts and averaged scores/verdicts matched exactly. It
reproduced the 26 admits. No source files changed.

```text
baseline SHA-256  bc102b7c8d4c0ec39d9ffad17784ad011f3f999f0b38f167680a96bfaab37c2e
answers SHA-256   0d174e0d25d29ddce9c51f841ba96062ab40b8db296e91d0fef2080950c619f1
stage fingerprint 580e7b73c45cf21936d5d7936bb5afadc1e2508562749aa060e3154cadb63170
```

This replay checks implementation equivalence against existing owner-accepted
evidence. It does not create a new evaluation or promotion.

## Development state and verification

On 2026-10-06, additive migrations 008 and 009 were applied to development.
The existing #11 decision was loaded as usefulness promotion
`74267477-c87e-45cb-a94e-fe49c5585687`, with zero calls. Development dry-run
returned the actual input `emulate`, POS `v`, with no selected result for either
gate and no appropriateness promotion. The ready bundle and intake identities
remain unchanged.

The saved appropriateness reassessment repeated with the same assessment
`55634f8be403678ae9479b9d3835906daa33704e27a4108c1680428daaafcd3d` and rule
identity. All inherited rows in the six evaluation tables and original aggregate
files matched. It made zero network requests. Qualification remains 20 correct
held-out averages of 21, with all 63 trials valid; no owner decision was inferred.

The full suite passed 303 tests with 12 skipped across 33 test files, using the
actual ready bundle and restricted logins in disposable databases. Typecheck
and whitespace checks passed. One browser test timed out during an earlier full
run; its six-test suite passed in isolation, then the complete suite passed.

Standards and spec reviews found no remaining actionable findings after fixes
for evaluation failure/resume, execution compatibility, append-only current
authorization, and credential-independent saved-reply persistence.
