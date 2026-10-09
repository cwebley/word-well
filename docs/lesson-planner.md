# Source-backed lesson planner

The #27 code path is implemented for private inspection and controlled checks.
The first owner-approved case was frozen before planner-answer generation. The
three-trial v4 paid evaluation is complete. Exact owner review and the configuration
promotion decision are the next acceptance steps.
The selected dataset version for that historical v4 evaluation was 2. Its sole case is development-only, with no
held-out performance claim. Version 1 remains retained; version 2 adds the
explicit split without changing the approved input or criteria.

The current selected dataset is version 3. Its definition-enriched paid evaluation
and the later verification amendment are recorded below. The owner approved
append-only revalidation of its original paid answers under the amended rule.
Exact content reviews and promotion remain separate decisions.

```text
ready source bundle + current factual intake + both promoted gate acceptances
    -> pipeline/planner-run.ts
    -> shared executor -> AI SDK/OpenRouter adapter -> encrypted charged completion
    -> saved inline verification proof, or terminal verification_unresolved
    -> complete source accounting -> selected plan + current authorization
    -> stop for inspection

frozen encrypted input + separate owner expectations
    -> evals/planner.ts -> same stage/executor/adapter, three fresh trials
    -> contract checks + expected coverage checks
    -> owner reads each trial and scores quality 1 to 5
    -> explicit promotion or non-promotion
```

## Files and boundaries

| File | Input, output and persistence |
| --- | --- |
| `pipeline/sources/planner.ts` | Maps candidate OEWN source meanings in retained order to `s1`, `s2` and later opaque references. Preserves recorded POS, entry/concept identities, candidate examples and typed contrast/family support. Adds the exact definition of every eligible linked OEWN contrast meaning |
| `pipeline/stages/planner.ts` | Owns the prompt, strict output schema, renderer and input-bound checks. The model-visible payload has normalized POS names, candidate definitions/examples and eligible contrast terms with their linked definitions. Source IDs, gate judgments and owner criteria are absent |
| `pipeline/execution/openrouter.ts` | Sends inline-metadata and response-cache-opt-out headers through the locked SDK once per physical request. Checks the recorded wire body, captures completion bytes and selected headers before SDK parsing, and extracts accounting independently. Makes no generation-metadata lookup |
| `pipeline/execution/luna-response.ts` | Requires returned dated-model/OpenAI evidence, an explicit single successful attempt and absence of response-cache replay. Separates missing proof from contradictions. Decodes historical lookup envelopes for inspection |
| `pipeline/execution/luna-setup.ts` | Makes a public metadata GET, with no generation, to check the dated OpenAI endpoint, required structured-output settings, input/output limits and price ceilings before dispatch |
| `pipeline/planner-config.ts` | Records timeout/retry settings and pricing evidence. Reserves against the full documented endpoint input limit and enforced inclusive output limit |
| `pipeline/planner-run.ts` | Uses current intake and both live gate acceptances, claims the candidate, reuses or generates one plan, saves original dependencies and appends current authorization. A no-meaning plan stops before writing |
| `pipeline/planner-identity.ts` | Separates whole-run resume compatibility from planner-specific content reuse. Gate authorization identities are not part of unchanged content identity |
| `evals/datasets/planner.ts` | Freezes immutable encrypted case inputs, source mappings and content-bound owner expectations. Uses the existing external dataset identity and durable file helpers |
| `evals/planner.ts` | Creates fresh three-trial experiments in existing private storage. Keeps failed and incomplete outcomes visible. Evaluation never writes production selections |
| `pipeline/planner-promotion.ts` | Saves exact-result owner reviews and explicit configuration decisions. Promotion needs every required trial to pass contracts and coverage expectations, plus factuality, grounding and coverage approval. Quality scores are comparative, with no threshold |
| `db/private-migrations/010_lesson_planner.sql` | Adds planner stage identities, immutable encrypted review/decision records and current usefulness/planner-promotion dependencies. Earlier source, gate and evaluation rows remain intact |
| `db/private-migrations/011_request_verifications.sql` | Adds append-only encrypted metadata verification rounds keyed to the original request. Neither the original response ciphertext nor its accounting columns are overwritten |

The shared executor saves and reconciles Luna accounting before interpreting
inline proof. Missing required evidence is terminal, while independent evaluation
trials can continue serially. Jev retains its existing execution behavior. The
[single-response contract](single-response-verification.md) covers exact evidence,
durable outcomes and the frozen historical recovery path. Current planner runs
use configuration v5; the retained paid v4 results keep their original identities.

## Prompt, schema and one actual source trace

`PLANNER_PROMPT` in `pipeline/stages/planner.ts` preserves the newer prototype's
compact editorial instructions. It adds source accounting and the approved
definition-backed synonym selection rule. Every supplied source meaning needs
defining support, a same-POS usage note or an explicit omission with a reason.
The output retains the prototype keys
`sense_ids`, `usage_note_sense_ids`, `synonyms` and `word_family`, with the approved
`omitted_source_meanings` addition.

The complete provider JSON schema comes from the same strict Zod schema used
for local output validation. All object properties are required and unknown
properties are rejected. Input-dependent checks reject unknown, missing or
duplicate source assignments, missing defining support, mixed-POS groups/notes,
unsupported selections and duplicates. Contrast and family limits are zero to
four. No result is silently dropped, repaired or regenerated.

The owner-approved [synonym inclusion rule](lesson-writer.md#approved-synonym-inclusion-rule)
requires each included term to add distinct, useful, evidence-backed guidance.
The [approved implementation](https://github.com/cwebley/word-well/issues/28#issuecomment-6084250455)
puts this decision in the planner prompt. It asks for a useful distinction
supported by the supplied definitions first. When terms have essentially the
same meaning and give the same guidance, it selects only the more common or
educational one. Shared qualities are allowed when the rest of the comparison
adds a meaningful distinction. Changing labels alone is insufficient.

Current configuration v5 enables `contrastEvidence: linked-definitions-v1`.
Each eligible contrast retains its target source ID and exact definition in
private input. Requests group definitions by term and omit source IDs, linked
usage examples and uncovered meanings. Missing or blank linked definitions stop
before dispatch, including for a term the planner might omit. Selection remains
prompt-led, without a definition-string rejection rule or a new human-review
step in the main pipeline.

Historical inputs may omit contrast definitions. Configurations without the
evidence mode retain their names-only renderer, even when an input has definition
fields. Frozen datasets, saved request identities and original paid answers stay
unchanged. The new mode requires an approved input containing linked definitions;
it does not enrich an old frozen dataset during loading or inspection.

The evanescent scope provides this actual model-visible input:

```text
headword: evanescent

s1 [adjective] tending to vanish like vapor
    examples: evanescent beauty
    similar terms: impermanent, temporary
    contrast definitions:
      impermanent: not permanent; not lasting
      temporary: not permanent; not lasting

word family candidates
  listed by both sources: evanescence
  listed by one source: evanesce, evanescently, multiple evanescent white dot syndrome, nonevanescent, unevanescent
```

1. `pipeline/sources/planner.ts` reads the selected ready bundle and maps `s1` to
   `oewn-evanescent__5.00.00.impermanent.00`, entry `oewn-evanescent-a`, concept
   `oewn-01761452-s`, recorded POS `a`, normalized POS `adjective`. This full
   mapping persists with each input and attempt, not in the prompt. The eligible
   contrast definitions come from `oewn-impermanent__3.00.00..` and
   `oewn-temporary__3.00.00..`, both in concept `oewn-01760139-a`.
2. `pipeline/stages/planner.ts` renders the input above and the exact strict
   schema. Production and isolated evaluation use the same renderer for the same
   input/configuration. Neither sees owner expectations or Wiktionary definitions.
   The original frozen evaluation input remains names-only and cannot run under
   the new evidence mode without a separately approved dataset version.
3. `pipeline/execution/openrouter.ts` forwards dated model
   `openai/gpt-5.6-luna-20260709`, the approved GPT Luna upstream. Routing admits
   only OpenAI, with fallbacks disabled and required-parameter enforcement.
   Structured output is `json_schema`, named `plan`, with `strict: true`.
4. `pipeline/execution/executor.ts` saves the attempt, reserves spend, records
   dispatch intent and calls the adapter. Raw reply, usage and validated plan
   persist through the existing encrypted store. The ledger contains accounting
   IDs and amounts only. Controlled checks exercise this boundary without live
   generation.
5. Production selects a valid plan and records its original intake and both gate
   result dependencies. Reuse appends current authorization while preserving those
   original dependencies. Evaluation retains separate experiments and trial IDs.
6. The owner reads all three evaluation answers and records exact-result factual,
   grounding and coverage findings plus a quality score. A separate explicit
   decision promotes or declines the configuration. A promoted plan still does
   not authorize lesson publication without the later writer and exact review.

The source trace exposed a family candidate that needs editorial judgment:
`multiple evanescent white dot syndrome` is a retained Kaikki Derived term. It is
eligible source input, not automatic lesson content. The prototype instruction
prefers useful forms and says to choose none rather than rare or negated forms.
Semantic review still decides whether any selection teaches the intended family.

The contrast trace exposes a different limit. Both eligible words have the same
selected definition, so the prompt must either find useful guidance supported
by those definitions or choose one representative. Rendering both definitions
does not prove the model will make that decision correctly. Scripted selection
tests verify the planner-to-writer path, without claiming a live quality result.

## Definition-backed selection checkpoint, 2026-10-09

The prompt-led rule and linked-definition input are implemented. The effective
planner configuration fingerprint at this checkpoint was
`53f0c39c2bd65e92e7700c88e0b83ceee911c8007ae2d264187ff2b9b921912c`.
Read-only rendering of the retained source bundle verifies that removing only
the new contrast definition fields recreates the original planner input exactly.
The original names-only frozen input stops with `planner_contrast_evidence_missing`
under the new mode, while historical inspection retains its original renderer.

Verification passed 428 tests with 12 skipped across 41 files, including the
restricted disposable-database planner and writer regressions, plus typecheck
and whitespace checks. New cases cover exact linked definitions, missing support,
private source-ID and linked-example exclusion, historical names-only rendering,
multiple definitions per term, scripted one-term selection passed to the writer,
shared contrast values, and prompt-led rather than string-based selection.
Standards and spec review found no findings.

Before/after checks preserve all 14,702 retained private rows across 35 tables,
all 34 inspected frozen-dataset, finalized-summary and receipt files, and the
exact historical inspection reports. All 13 files in the uncommitted #34 repair
and its compatibility policy identity remain unchanged. The retained frozen
runtime archive matches its original checksum. Its extracted temporary copy is
incomplete; no restoration or recovery ran. No new model call, metadata call,
dataset freeze, production selection or promotion ran for this revision. This
verification preceded commit and push. Fresh model quality for the new prompt
is untested.

## Definition-enriched evaluation and optional history amendment

The owner approved the exact private definition-enriched input and separate
expectations. Encrypted planner dataset version 3 is frozen and reload-verified,
with one development case and no held-out claim. Versions 1 and 2 remain intact.
The new input adds only the eligible linked contrast definitions. Original
source-coverage expectations and four original semantic criteria are retained;
the approved semantic additions stay outside the model request.

The separately authorized three-trial evaluation under a $1.23 cap completed as
experiment `b22c4dd3-a565-45e7-9802-b602bbeaf224`. Its identity was saved before
dispatch. Three original charged replies persist, with no transport retries or
generation-metadata lookups. Cost was $0.001854, with no outstanding reservations
or unresolved charges. All three replies omitted detailed attempt history and
ended terminal verification-unresolved under the original strict configuration.
These outcomes and their original identities remain unchanged.

The owner then approved accepting OpenRouter's documented successful attempt
number without requiring its optional detailed history. Current planner v5 uses
`routingVerification: completion-inline-attempt-number-v1`, with effective
configuration fingerprint
`ea7df84a68c7118b954b445bde3e5683916e114ac0e25d2a70014e8f927c653a`.
The prompt, rendered request, frozen input, separate expectations and spending
controls remain unchanged. Saved strict configurations still require history.

Offline replay passes amended routing, planner content and required coverage
checks for all three original responses. This is a new diagnostic interpretation,
not a change to the stored trials or an owner semantic review. The owner
subsequently approved a separate record of this revalidation, with original
outcomes preserved. Details and preservation checks are in
[single-response verification](single-response-verification.md#optional-attempt-history-checkpoint-2026-10-09).

## Append-only reuse of paid planner answers

The [owner-approved reuse](https://github.com/cwebley/word-well/issues/28#issuecomment-6088340503)
applies to the exact retained three-trial experiment above. It does not authorize
new generation, metadata recovery, changed input or expectations, or promotion.

```text
original paid responses + frozen input and separate expectations
    -> check the approved source snapshot and policy-only configuration change
    -> current routing, content and required coverage checks
    -> encrypted immutable planner revalidation record
    -> exact owner reviews bound to this record and its result fingerprints
    -> separate promotion or non-promotion decision
```

`pipeline/planner-revalidation.ts` binds the approved experiment, original
implementation and rule, complete encrypted source-row snapshot, current
configuration, implementation and review rule, original request and response
fingerprints, case/trial membership, charges and revalidated plans. Creation
checks the retained accounting receipts. The current request must reproduce the
original request exactly. Every original response must have stopped only for
missing strict routing proof and must pass the amended routing, content and
shared required-coverage checks. Expectations stay outside model requests.

`pipeline/storage/planner-revalidations.ts` owns persistence and read-only source
snapshot hashing. Migration 015 adds `private.planner_revalidations`, without
altering existing tables. PostgreSQL rejects updates and deletes. Identical
revalidation is idempotent, including concurrent creation, and retains the first
ciphertext. A changed source snapshot, configuration, implementation or review
rule invalidates the proof. Inspection and authorization never refresh it.

For this actual source trace, trial 1 remains an original
`verification_unresolved` attempt. `attempt: 1` and the selected dated OpenAI
endpoint now permit current validation. The new record retains that trial's
original attempt/request IDs and charge. It records a separately identified
result, without modifying the original attempt, response, receipt or dataset.
The trace exposes a review boundary: a successful technical recheck is not an
owner finding that the authored definition or selected terms are good.

Revalidation reviews use `wordwell-planner-trial-review-v2` and a `revalidationId`.
They bind each result fingerprint to owner factuality, grounding, coverage and
comparative quality findings. Old trial reviews cannot satisfy this requirement.
Promotion still needs every required trial and all exact owner reviews to pass;
quality scores have no threshold. A revalidation-backed promotion uses schema
`wordwell-planner-promotion-v2` and requires the current proof at authorization
time. Production reads that proof using the storage key, without owner labels.
Later non-promotion takes precedence. Revalidation itself selects no production
plan and starts no writer.

```sh
npm run --silent eval:planner -- revalidate --owner-approval <private-approval-file>
npm run --silent eval:planner -- inspect-revalidation <revalidation-id>
npm run --silent eval:planner -- review --owner-review <private-review-file>
npm run --silent eval:planner -- decision --owner-decision <private-decision-file>
```

These operations make no provider calls. The approval file names the exact
approved source experiment and the recorded owner reuse decision. Review and
decision files must name the same revalidation. Missing or stale proof stops
without changing the source record or generating a replacement answer.

The approved revalidation is recorded in the retained local store. Repeating
creation and inspection returns the same proof and preserves its first ciphertext.
Before/after verification preserves all 14,713 inherited rows across 35 tables,
all 17 inspected frozen-dataset and ledger files, six historical inspection
reports, both retained archive checksums and the gate compatibility policy.
Migration 015 and one immutable revalidation row are the only additions. There
are now 36 private tables. Original cost remains $0.001854; added cost and provider
calls are zero. No owner review, promotion or production selection was recorded.

Verification passed 451 tests with 12 skipped across 42 files, plus typecheck and
whitespace checks. Standards and spec reviews have zero remaining findings.
Checks cover idempotency, concurrent creation, immutable ciphertext, source and
interpretation changes, exact owner review bindings, explicit promotion and later
non-promotion, unfinished evaluation review, private import boundaries and learner
access rejection. Generated plans and exact owner criteria remain private.

## Locked model and accounting checks

The pinned course main commit `36d95d1b0b0839e180cfdfcb6d18a896e0582068` uses AI SDK
major 6. This implementation locks `ai` 6.0.146 and
`@openrouter/ai-sdk-provider` 2.10.0, a compatible major-6 pair. SDK retries are
disabled with `maxRetries: 0`; tracing is disabled. The executor retains two
transport retries, delays of 2 and 8 seconds, a 60-second maximum retry wait and
a 600-second request timeout.

Read-only endpoint verification on 2026-10-07 found:

- Dated upstream `openai/gpt-5.6-luna-20260709`, default provider tag `openai`.
- Maximum input of 922,000 tokens and maximum completion of 128,000 tokens.
- Support for `max_tokens`, `response_format` and `structured_outputs`.
- Default prompt/completion prices of $0.20/$1.20 per million tokens. The tier
  beginning at 272,000 prompt tokens costs $0.40/$1.80 per million.
- The request enforces a 16,000-token output limit, including reasoning, and
  price ceilings of $0.40/$1.80 per million, with no request fee or tools/plugins.

The conservative reservation per physical request is:

```text
922,000 × 400 nano-USD + 16,000 × 1,800 nano-USD = 397,600,000 nano-USD
                                                   = $0.3976
```

This is an allowance against the run cap, not an expected charge. Three initial
evaluation requests need $1.1928 of conservative capacity. Actual charges settle
the reservations. Configured retries also consume the same cap. Unknown cost is
never zero. The completed v4 paid proof settled all three charges. Controlled SDK
tests and saved live receipts verify raw accounting retention.

Public verification sources are the OpenRouter dated-model endpoints API,
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs),
[reasoning token budgets](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
and OpenAI's inclusive `max_completion_tokens` contract.

## Commands and failure paths

These inspection commands make no generation calls:

```sh
npm run --silent pipeline -- planner run --candidate evanescent --bundle <ready-bundle-id> --dry-run
npm run --silent eval:planner -- dry-run --dataset <frozen-private-dataset-directory>
npm run --silent eval:planner -- inspect <experiment-id>
npm run --silent eval:planner -- recover <experiment-id>
npm run --silent pipeline -- inspect <planner-run-id>
npm run --silent pipeline -- recover <planner-run-id>
```

Paid evaluation requires its own explicit owner-approved cap:

```sh
npm run --silent eval:planner -- run --dataset <frozen-private-dataset-directory> --max-cost-usd <approved-cap>
npm run --silent eval:planner -- resume <experiment-id>
npm run --silent eval:planner -- review --owner-review <private-review-file>
npm run --silent eval:planner -- decision --owner-decision <private-decision-file>
```

Normal production planner execution requires selected, current acceptance from
both gates and the explicit planner promotion. It generates one plan, not three
averaged plans. A stage-only fresh command stops after its new planner result:

```sh
npm run --silent pipeline -- planner run --candidate evanescent --bundle <ready-bundle-id> --max-cost-usd <approved-cap>
npm run --silent pipeline -- run --candidate evanescent --bundle <ready-bundle-id> --stage planner --fresh --max-cost-usd <approved-cap>
npm run --silent pipeline -- resume <planner-run-id>
```

- Unpromoted configuration or missing/currently rejected gates stops production
  before dispatch. Evaluation directly tests frozen inputs independently.
- An unchanged normal planner run reuses its selected plan with zero calls.
  Changed source mappings or effective planner settings require a different
  content identity. Changed gate acceptance alone rechecks authorization.
- A no-meaning plan remains inspectable and stops before writing. It is not a
  candidate-gate verdict.
- Invalid output, refusal or truncation stops without a repair call. A failed
  fresh attempt preserves the previous valid selection.
- A newly failed evaluation trial stops dispatch. Explicit resume retains that
  failure and continues the remaining intentional trial identities. Reports
  retain the full required denominator, so an incomplete case cannot pass.
- Accounting or storage blockage pauses the owning run. Resume reads saved work;
  unknown timeout/disconnection charges remain reserved. Recovery cannot
  redispatch an uncertain request or invent a reply.
- Missing inline evidence ends a future planner trial as `verification_unresolved`
  with its answer and charge retained. Other eligible evaluation trials continue
  serially within the cap. `recover` interprets only existing saved work and cannot
  dispatch remaining trials, query generation metadata or reopen unresolved proof.
  Historical metadata recovery belongs to the frozen runtime under its original
  identity and still requires explicit owner authorization.
- Changed interpretation or dependency artifacts stop incompatible resume.
  Each experiment saves the interpretation identity it actually tested.
  Promotion cannot restamp older evidence under changed rules. Promotion checks
  bind that tested identity to the current review/validation rule; writer-only files do
  not change planner content reuse or the gate interpretation identities.
- Losing candidate ownership during asynchronous setup stops before the paid
  send. Permission loss can terminalize a stopped operation and release its
  persistent claim without requiring permission to generate another answer.

## Course comparison and acceptance state

WordWell follows the pinned course's dataset, task, shared implementation,
scorer and experiment comparison arrangement. The course's diagram agent uses
canvas effects and structural scorers. WordWell performs one structured planner
operation per attempt, saves durable private evidence, checks gate permissions,
separates production selections from evaluations and requires human semantic
review. Its code checks do not claim that a definition is good merely because
its references are valid.

The preflight development dry-runs had no selected planner result or planner promotion. The
normal unpromoted path is verified to stop before creating a production run.
The additive migration and inspection preserve inherited gate/evaluation rows
and external frozen artifacts. The subsequent paid proof is recorded below;
no writer call has run from this work.

The final full suite passed 337 tests with 12 skipped across 36 files. Typecheck
and whitespace checks passed. Planner contract, setup and coordination checks
account for 33 tests, using scripted replies and restricted disposable databases.
The development preservation check verified all 14,611 inherited private rows,
including ciphertexts and original columns across the additive migration.

Standards review found no remaining documented-standard violations or actionable
correctness findings. Two non-blocking duplication notes remain for identity
collection and saved-attempt validation. Spec review found no remaining
actionable findings after ownership fencing, tested-rule promotion binding and
non-dispatching accounting recovery fixes. Recovery tests include storage still
blocked while generation permission has been revoked, followed by successful
charge restoration without another model request.

## First paid proof and routing-verification correction

The first approved evaluation stopped after one request because the original
validator expected the dated upstream in the completion's top-level `model`
field. OpenRouter returned the canonical Luna alias there. A saved-reply replay
isolated that field as the failure; the plan's source-accounting checks passed.
The paid trial remains invalid under its original v1 interpretation. It is not
rewritten as a passing trial.

OpenRouter's authenticated generation metadata reports the dated model and
`provider_responses[].model_permaslug`, with the serving provider and any fallback
attempts. The actual captured generation verified the requested dated upstream.
See the [generation metadata contract](https://openrouter.ai/docs/api/api-reference/generations/get-generation).

Configuration v2 preserves the dated request, strict schema, prompt, output cap,
OpenAI-only routing and price ceilings. It accepts the canonical reply alias only
when saved authenticated metadata for that exact generation proves the dated
model, OpenAI provider, one successful provider response and no response-cache
reuse. Missing, mismatched or unavailable proof fails the attempt. A lookup
failure still retains the billable completion and its charge.

The completion and lookup bodies are saved as original strings inside one
versioned envelope in the existing encrypted request-response row. Neither raw
body is rewritten. Gate interpretation files and gate reuse identities are
unchanged. Historical v1 experiments remain inspectable under their original
rules, but new generation requires v2. A new paid comparison needs a fresh
three-trial experiment and an explicit budget; old failed history remains saved.

The actual captured completion and authenticated metadata replayed successfully
through the v2 verifier with network forbidden. The original trial remains
invalid under v1, with its original request, response and charge unchanged.
The post-fix full suite passed 339 tests with 12 skipped; typecheck and whitespace
checks passed. Focused standards and spec reviews found no actionable findings.

## Metadata availability delay

The v2 paid proof stopped when the immediate generation-metadata GET returned
404. A later read for the same generation returned the expected dated upstream
and provider evidence. That paid failure remains retained under its original
interpretation.

Configuration v3 records a metadata-read policy of at most six GETs within 30
seconds. Delays are 1, 2, 4, 8 and 8 seconds, increased for a valid Retry-After
header when it fits the deadline. Only not-yet-available and transient HTTP
statuses are retried. These are non-generating reads, not repair calls or model
transport retries. The original completion and every received lookup body remain
in the same encrypted response row. The selected proof must be the last lookup
and must still meet the exact dated-model/provider/generation/cache checks.

Never-available evidence still fails without another generation and retains the
known charge. Historical v1/v2 experiments remain readable, and new generation
requires v3. The frozen source input, owner expectations and model-visible
request remain unchanged. A fresh three-trial run needs explicit authorization.

The actual saved 404 followed by the later authenticated 200 response replayed
successfully through the v3 adapter and validator with real network forbidden.
It used one simulated completion, two simulated metadata reads and preserved
the original completion bytes and charge. The original v2 trial remains failed.
Post-fix verification passed 341 tests with 12 skipped, typecheck and whitespace
checks. Focused standards and spec reviews found no actionable findings.

## Resumable metadata verification

The owner approved metadata-only recovery before another paid run. Configuration
v4 records this behavior separately from historical v1/v2/v3 interpretations.
The model-visible request, frozen source input and owner expectations are unchanged.

```text
completion POST
  -> original encrypted response + accounting receipt + settled known charge
  -> metadata GET round, at most six attempts within 30 seconds
  -> append-only encrypted verification record
     -> valid upstream proof: validate the saved plan
     -> unavailable proof: keep attempt pending and pause
        -> recover: GET metadata for the same generation, then append another round
     -> wrong model/provider/generation, cached answer or malformed proof: fail
```

`pipeline/execution/executor.ts` calls the adapter's verification method only after
the completion and accounting are durable. `private.request_verifications` keeps
each round in sequence with its fully received raw lookup bodies, lookup attempt
count and deferred retry time. Network failures count toward the six attempts even
when no response body arrives. The original `private.requests.response_payload`
stays unchanged. Validation and inspection read the latest verification record;
earlier rounds remain inspectable.

Metadata 404, 408, 429, 500, 502, 503, 504, 524 and 529 responses and network errors
are retryable within a round. Exhausting a round pauses verification rather than
failing the generated answer. A longer Retry-After survives restart and prevents
an early recovery read. Each explicit recovery is bounded; there is no automatic
unlimited poll loop. Missing metadata credentials also leaves the attempt pending.
Recovery does not require permission to generate. Production still rechecks current
gate authorization before selecting a plan, and revoked permission releases the claim.

The actual retained evanescent trace remains two completed requests, each supplying
the same `s1` adjective input described above. The first returned the model alias;
the second's immediate metadata lookup returned 404. Both historical attempts remain
failed under their recorded interpretations. Recovery applies to new pending v4
attempts, not to rewriting those failures. No paid v4 experiment has run yet.

Controlled checks cover repeated unavailable rounds, same-generation recovery,
unchanged original response ciphertext, settled accounting before lookup, metadata
storage failure, deferred retries, missing credentials, lost ownership, revoked
gates, wrong upstream/cache evidence and evaluation recovery without starting
remaining intentional trials. A separate fresh paid evaluation and exact owner
reviews remain acceptance work.

Both actual saved completions and authenticated metadata replayed through the shared
executor in a disposable encrypted database with real network forbidden. The delayed
case used one simulated completion, six unavailable reads and one recovery read.
Recovery validated the same answer and preserved its original response ciphertext.
The additive migration preserved all 14,621 inherited private rows, including the
two stopped experiments. Original frozen artifacts and existing gate promotions
also matched. There are no live verification rows or new model calls from this fix.

Final verification passed 356 tests with 12 skipped across 37 files, typecheck and
whitespace checks. Standards review found no hard violations and one non-blocking
duplication note for saved-plan validation. Spec review caught a Retry-After header
lost when a metadata body disconnected. A failing streaming-response regression
reproduced it; the corrected lookup preserves the cooldown before reading the body.
Re-review found no remaining actionable spec findings.

## Completed v4 paid evaluation

The owner authorized a fresh three-trial v4 experiment under a $1.23 cap. Experiment
`78b61605-6829-48e1-bc13-5f7fe849ad7d` used the selected frozen development dataset
version 2. Preflight verified the unchanged model-visible request, dated OpenAI
endpoint, supported schema settings and conservative reservation.

The run completed three intentional generation requests with no transport retries.
All three saved results pass deterministic contract and approved coverage checks.
Each generation's metadata round received four 404 responses followed by a 200 on
the fifth read. All 15 fully received lookup bodies are retained. No separate
metadata recovery round or replacement generation was needed.

The run cost $0.0011568. Combined cost across the two historical stopped experiments
and this completed experiment is $0.0018584. All charges match the accounting ledger;
there are no outstanding reservations or unresolved charges. Reinspection with
network forbidden revalidated the saved results. Snapshot comparison verified all
inherited rows, original response ciphertexts, frozen artifacts and gate promotions
remain intact.

Generated plans and per-trial owner reviews remain private. All three plans are
ready for the owner's factuality, grounding, meaning-coverage and quality review.
No planner review, promotion or production selection has been recorded from this
run. The dataset still has one development case and no held-out performance claim.
