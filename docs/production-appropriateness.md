# Durable production appropriateness

The #25 coordinator and saved-evidence assessment are implemented. Appropriateness-only
runs stop here; #26 adds [durable usefulness](production-usefulness.md) to normal
runs. The ready `emulate` bundle has passing intake, but no live
production gate result, lesson plan, written lesson or learner publication exists
from this work. Owner promotion remains the decision in #17.

```text
explicit ready source bundle -> today's passing intake
                                      |
                         fixed production run instructions
                                      |
                     candidate claim + current owner promotion
                            /                    \
                  unchanged selection      three deliberate trials
                          |                 shared stage/executor
                          |                 encrypted attempts/replies
                          |                 accounting-only receipts
                          |                      |
                          |             valid unrounded average
                          |                      |
                          +----> selection + authorization + stop

frozen private evaluation -> same stage/executor -> saved trial evidence
                                                    |
                                       versioned 95% assessment
                                         zero model requests
                                                    |
                                       explicit owner decision in #17
```

## Files and saved boundaries

| File | Responsibility and durable result |
| --- | --- |
| `pipeline/sources/index.ts` | `authorizeScopedCandidate` verifies the explicitly selected ready bundle and current config-matching intake. It returns candidate, lesson and assessment identities, with `{ "headword": "emulate" }` alone as gate input |
| `pipeline/production-config.ts` | Strict fixed run instructions include mode, exact input, selected bundle, original intake, v4 configuration, execution/pricing material, implementation identity and reuse identity |
| `pipeline/run.ts` | The coordinator checks today's intake and promotion, claims the candidate, chooses reuse or fresh trials, selects a valid average, and stops. `authorizeDownstream` checks current intake, matching live acceptance, its three saved trials and owner promotion |
| `pipeline/reuse.ts` | Headword/request/configuration and stage interpretation identify reusable judgments. The whole-run implementation identity controls resume compatibility separately |
| `pipeline/stages/appropriateness.ts` | Existing v4 questions, renderer, raw-response validator and deterministic policy. Three valid trials are averaged per question, without rounding, before main 0.50 and slur 0.40 thresholds. Ties reject |
| `pipeline/execution/executor.ts` | Shared evaluation/production attempt lifecycle, bounded transport retries, reservations, accounting and encrypted reply saving. Recovery can reconcile and validate with dispatch disabled |
| `pipeline/storage/postgres.ts` | Existing encrypted attempt/request store now admits either an evaluation experiment or a production run. Selection transactions use the lock-owning connection, so losing that session cannot commit a selection. No second full-response store exists |
| `pipeline/storage/receipts.ts` | Existing accounting-only ledger also accepts a production run ID. Historical experiment receipts remain readable. It contains no words, prompts or replies |
| `pipeline/storage/production-local.ts` | Reuses the provisioned pipeline login and existing storage identity. Production never loads the dataset identity |
| `pipeline/promotion.ts` | Verifies frozen membership and saved raw trials, computes the new assessment, reports development misses and loads explicit owner decisions. It never invokes a model |
| `db/private-migrations/006_production_appropriateness.sql` | Additive run ownership, claims, trials, results, selections/history, authorizations, assessments and promotions. Run instructions and completed production evidence are immutable |
| `db/private-migrations/007_frozen_summaries.sql` | New evaluation finalizations retain their exact encrypted aggregate snapshot and digest. Existing finalized rows stay untouched |

Production execution uses the existing verified execution/pricing configuration
in `config/private-appropriateness.json`. `config/pipeline.yaml` supplies today's
intake policy. `pipeline config show` displays both. Saved instructions retain
their original intake configuration, but resume checks the currently selected
intake policy before dispatch or selection. Changed intake requires its own
current assessment, not an automatic new headword judgment.

## Operator commands

```sh
npm run db:migrate
npm run --silent pipeline -- config show
npm run --silent pipeline -- run --candidate emulate --bundle <ready-bundle-id> --dry-run
npm run --silent pipeline -- run --candidate emulate --bundle <ready-bundle-id> --max-cost-usd <explicit-cap>
npm run --silent pipeline -- run --candidate emulate --bundle <ready-bundle-id> --stage appropriateness --fresh --max-cost-usd <explicit-cap>
npm run --silent pipeline -- inspect <run-id>
npm run --silent pipeline -- recover <run-id>
npm run --silent pipeline -- resume <run-id>
```

The CLI uses live production permissions. It exposes no unpromoted controlled-call
bypass. Unpromoted normal execution returns `configuration_not_promoted` before
creating a production run or sending a request. Dry-run and inspection make zero
calls. Inspection contains decrypted private inputs and replies.

`--stage appropriateness` stops at this stage. `--fresh` requires that explicit
stage selection and always creates new trial identities. Unknown stages,
conflicting options and absent source selections or caps fail. Resume preserves
the saved cap and execution configuration. `resume --config PATH` selects today's
intake policy, independently of the original recorded policy.

Production receipts use the existing ledger implementation at
`~/Library/Application Support/WordWell/production/ledger/receipts.jsonl`.
Evaluation receipts remain in their existing directory. Both contain accounting
metadata only and survive database write failure.

## Actual source-backed controlled walkthrough

The local coordinator checks read the already ready development bundle
`33151aac5fdc58d06266eba9a6071adf9f9def58b64ec96d622dbe891c3f7e78`.
They copy its saved evidence into unique disposable databases. They use restricted
pipeline/learner logins, harmless in-memory keys and scripted System One replies.
They do not read acquisition files, restart extraction or send live requests.

1. `pipeline/run.test.ts` loads that bundle through
   `pipeline/storage/source-local.ts`. The stored frequency is direct Zipf 3.41.
   `buildScopedCandidate` records passing intake in the disposable database.
   `authorizeScopedCandidate` supplies the exact input `{ "headword": "emulate" }`.
   The production run stores the source selection, original assessment and stable
   candidate/lesson identities under the storage key. Request count is zero.
2. `pipeline/run.ts` acquires a database session lock and persists a candidate
   claim with run ID and ownership token. No transaction remains open while a
   model reply is awaited. The fixed test run records `executionKind: controlled`.
   That marker prevents its results from authorizing downstream production.
3. The existing renderer sends `model: typesafe/jev-1.13`, `state: emulate` and
   the existing main/slur questions. POS, source definitions, labels, frequency,
   owner expectations and reasons are absent. Each intentional trial gets an
   opaque shared-store attempt ID. Each physical request reserves 1,344,000
   nano-USD, saves dispatch intent and then invokes the scripted adapter.
4. The first fixture returns main probabilities 0.8, 0.1 and 0.1, with slur
   probabilities 0.2, 0.1 and 0.1. Every reply identifies pinned model
   `typesafe/jev-1.13-20260917`, and each has known cost 17,304 nano-USD.
   PostgreSQL stores three encrypted raw exchanges and validated trial results.
   The first individual trial rejects. The unrounded main mean is 1/3 and the
   slur mean is about 0.1333, so the production-style averaged verdict accepts.
   Total is three physical requests and 51,912 nano-USD.
5. The coordinator saves an immutable aggregate linked to the three attempts,
   makes it selected and appends selection history. The same transaction records
   current intake authorization and clears ownership. Stage-only stops here.
6. An unchanged new run reuses that selected aggregate, appending its own
   authorization without changing the original source/intake provenance. It has
   zero requests. A newly assessed ceiling of 3.6 also reuses the judgment.
   A current ceiling of 3.4 excludes `emulate` and stops before any call, even
   though the old passing assessment and selected judgment still exist.
7. A fresh malformed reply makes the run fail after one request. It has no
   verdict and leaves the earlier selection intact. A later explicit fresh run
   with three slur probabilities of 0.40 produces a valid rejection, replaces
   the selection and stops. A subsequent unchanged run reuses that rejection
   with zero requests.

These are controlled coordinator outcomes, not claims about Jev's live judgment
of `emulate`. The actual development database receives the additive migration and
saved promotion assessments, not those disposable production selections.

The final development dry-run on 2026-10-06 returned candidate
`5d136aff-673e-4a87-ac0d-efa18c34ef4e`, stable lesson
`a1997b2c-ab2a-4f55-8070-661ea7fab52b`, and current passing intake assessment
`ea8897abde19f6f24990b87317530f2dbc8b14e9ede605bac26a12e4c0ae89da`.
The selected production result and owner promotion were both null. Pricing was
verified, and request count was zero.

## Evaluation and saved promotion evidence

`evals/private-appropriateness.ts` still maps frozen experiment/case/trial IDs to
the same executor. Direct evaluation bypasses production source intake and owner
promotion. It never writes production selections. Inputs and expectations remain
separate ciphertexts under their respective keys.
The evaluation lock exposes the same live ownership check before requests and
terminal outcomes. Terminal attempt writes use that lock-owning transaction after
encryption. Losing its connection stops further dispatch and prevents stale valid
outcomes. Finalization saves the exact encrypted aggregate and digest through the
same connection before publishing its file. File-write retry uses that frozen
snapshot, even if late accounting has changed current totals.

The new assessment loads the frozen dataset artifact, checks exact membership,
inputs, expected labels and splits against the saved experiment, and validates
the saved raw replies under its recorded configuration. It retains the original
implementation and finalized summary identities. Its rule identity includes the
assessment, scoring, averaging and frozen-dataset interpretation code. A repeat
must reproduce identical material for the same assessment identity.

The current promotion rule requires a nonempty frozen held-out set with three
valid trials for every case. At least 95% of averaged verdicts must be correct.
Both wrong accepts and wrong rejects count. The comparison uses integer counts,
not a rounded display percentage. Individual errors and development misses stay
visible; they are not separate vetoes or a second 95% requirement. Mixed-split
experiments also report their development cases by recorded split.

```sh
# Migration, reassessment twice, history/artifact preservation and zero-network check.
npm run eval:private:assess-promotion

# Ordinary new assessment of an explicitly selected finalized experiment.
npm run --silent pipeline -- promotion assess 26c79436-6675-4181-bf41-df1cd5444da7 --dataset appropriateness-v000007
```

Verified saved v4 held-out experiment
`26c79436-6675-4181-bf41-df1cd5444da7` has 20 correct averages of 21, or 95.24%.
All 63 trials are valid. There are zero averaged wrong accepts, one averaged wrong
reject, zero individual wrong accepts, three individual wrong rejects and zero
unstable cases. It qualifies. The saved development experiment on dataset v6
remains reported as 21 correct averages of 24, with one wrong accept and two
wrong rejects. Its known miss does not block held-out qualification.

The verified current assessment identities are:

```text
assessment  55634f8be403678ae9479b9d3835906daa33704e27a4108c1680428daaafcd3d
rule        c1c53e7f137fe21bed9d6b4c537303d00f6c2ec7b51508244b8e69a386066b37
evidence    2a025cec4d52ccaf6be7299c85984a7087d62110695d92eeaa5ca4e4d3d2a37e
config      a0a0c4bfcef786f6c15b7f0baa37e16d89206ad89d0c95ee67a8a9ba659fb097
dataset     2099a28a-67b4-40f3-9e58-9b9dfced5a85, version 7
content     f28d012dcd4ddedd7b41d7c2f6798f4fa9a438d547a873cd0fc5aef02d177c59
ciphertext  d478596af9bbcc1067d67edbf5e12a800b3b96fae6b656e04814244e590663c0
```

Earlier implementation-time assessment versions remain saved under their own
identities. Owner permission must reference the current rule and exact assessment.

The assessment operation verifies unchanged encrypted history in all six
evaluation tables and unchanged original aggregate files. It makes zero network
requests. It writes a separate encrypted `private.promotion_assessments` row and
does not rewrite historical scores, summaries or exports.

After the owner records a decision in #17, an explicit owner-decision file can be
loaded with `pipeline promotion record --owner-decision PATH`. Its strict fields
are `schema: wordwell-owner-stage-promotion-v1`, `reviewer: local-owner`, the
exact #17 issue URL, its actual decision-comment URL, assessment ID and either
`promote` or `do_not_promote`. Promotion requires qualifying evidence under the
current rule and the exact configuration fingerprint. That decision is persisted
under the storage key. A later non-promotion removes permission. No such decision
was made or recorded for development production in this implementation.

## Failure, concurrency and restart

| Situation | Result and next action |
| --- | --- |
| Another coordinator owns the candidate | `candidate_busy`, with owner run available for inspection. No duplicate dispatch or selection write |
| Prior pending owner connection ended | `candidate_recovery_required`. Explicit recovery acquires the same session lock before changing ownership. Time alone permits no takeover |
| Known pause for budget, accounting, storage or retry timing | Ownership remains durable. Resume of that same paused run may continue; a competing normal run cannot start replacement trials |
| A delayed resume read pending just before another command completed | Claim acquisition rechecks terminal status. It returns the completed result without reclaiming ownership or duplicating authorization |
| Lock-owning connection fails | Its error listener suppresses raw driver errors. Ownership becomes unusable. Tokens fence subsequent selection writes; recovery verifies the old connection ended |
| Missing live API key | Fixed `model_key_required` before reservation or dispatch intent. Nothing is sent or falsely counted as an uncertain request. Saved reuse needs no provider key |
| Permission changes after intent but before send | A durable `dispatch_cancelled` receipt records that the send never began. The reservation is released and the attempt fails without a gate verdict. Recovery honors cancellation even if its PostgreSQL write failed |
| Accounting intent append fails | Reservation abandoned, pause, zero requests. Resume uses the same attempt |
| Outcome append fails after a reply | Encrypted reply remains saved; pause. Resume restores the receipt before further dispatch |
| Temporary PostgreSQL write failure | Executor retries with the reply in memory. No new model request |
| Reply lost after permanent PostgreSQL failure | Ledger keeps its charge. Recovery imports it and finishes `response_lost`, without redispatching |
| Intent exists without an outcome | Recovery marks `uncertain`, retaining the reservation. Resume never replaces that request. Deliberate new work requires a fresh run |
| Known charge arrives after recovery terminalized an uncertain request | Zero-dispatch accounting reconciliation imports the charge without changing the uncertain execution outcome or creating a gate verdict. Repeat import cannot double-count it |
| Reply saved before terminal validation | Recovery validates the saved exchange and stops with no calls. Resume can finish the remaining trials |
| Invalid response or transport retry exhaustion | Failed run, no gate verdict. Earlier valid selection remains intact |
| Valid fresh rejection | New selected rejection blocks downstream authorization |
| Recorded implementation is unavailable | `implementation_changed`, no dispatch or reinterpretation under current run code |

Recovery may read receipts, settle existing reservations and validate saved
replies. It never sends a model request. It clears verified interrupted ownership
after recording recovered progress. Unknown charges remain committed reservations,
never zero. Failed fresh attempts and terminal failures are not replaced on resume.

The trace exposed two operational details. A successful first trial does not
create a reusable three-trial result, so paused ownership must block competing
normal runs. Also, an API-key check made only inside `send` would create a false
dispatch intent. The credential check now runs before the reservation boundary.
Ownership is reasserted after all asynchronous prerequisite checks, immediately
before send. Confirmed pre-send cancellation and actual uncertain dispatch remain
separate accounting events.

## Verification

```sh
WORDWELL_PRODUCTION_READY_BUNDLE=33151aac5fdc58d06266eba9a6071adf9f9def58b64ec96d622dbe891c3f7e78 npm run test:production
npm run typecheck
```

The coordinator suite tests real overlapping commands, delayed same-run resume,
stale ownership, an actual terminated lock connection, controlled headword-only
requests, current intake, selections/history, pauses, reservations, encrypted
replies, failures and zero-call recovery. It also tests a complete disposable
evaluation-to-assessment-to-owner-record-to-production authorization path using
controlled replies. The learner login cannot read any new private table.

The assessment suite proves that individual errors and development misses can
coexist with qualifying averaged accuracy. Invalid/missing trials and smoke work
cannot qualify. Historical ciphertext rows, finalized summaries and exports stay
under their recorded original rules. Owner decisions used in tests are disposable
fixtures and do not constitute the real #17 promotion decision.

Verified on 2026-10-06:

- All 18 production/assessment tests passed using the saved ready bundle.
- The full suite passed 290 tests with 12 skipped across 33 test files. Relevant
  private database suites ran with actual restricted logins in disposable databases.
- Typecheck and whitespace checks passed.
- The saved assessment repeated identically with zero network requests. All 20
  experiments, 1,344 cases, 3,913 trials/attempts/requests and 1,305 scores retained
  their inherited row contents and encrypted bytes. Original aggregate files matched.

## Review

### Standards

The final review found no remaining actionable hard violations or correctness
findings. Fixed-code error handling now covers both live lock connections and
closing fixture pools.

### Spec

The final review found no remaining actionable spec findings. Corrected findings
included delayed resume ownership, paused-run claims, cancellation before send,
late accounting, stale terminal/selection/score writes and exact frozen-summary
recovery. Regression checks exercise those paths through actual ownership and
storage interfaces.
