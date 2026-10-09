# Lesson writer

The #28 writer implementation uses the shared Luna executor for production and
isolated evaluation. Controlled verification uses synthetic evidence and scripted
provider replies. The first three-trial paid development evaluation is complete.
Owner semantic review, promotion and the first normal writer selection remain
acceptance work.

Current writer v2 uses `routingVerification: completion-inline-attempt-number-v1`.
The owner-approved shared verification amendment accepts returned first-attempt
success without an optional detailed history list, while retaining exact dated
OpenAI selection, cache and contradiction checks. Supplied history remains
validated. The effective configuration fingerprint is
`23ef47dc15d4f7ecb4b1c4a4b355223237d6c65be58041a8d28b6a9fe65d7c57`.
This changes local verification only. The writer prompt, request, frozen inputs
and spending controls are unchanged. Saved strict configurations retain their
original interpretation. No new writer generation or promotion follows from
this amendment. See [single-response verification](single-response-verification.md#optional-attempt-history-checkpoint-2026-10-09).

```text
Ready source bundle + current gates + promoted selected planner result
    -> pipeline/sources/writer.ts -> fixed writer input
    -> pipeline/writer-run.ts -> shared executor -> verified Luna adapter
    -> encrypted completion + settled accounting
    -> single-response inline verification, or terminal unresolved proof
    -> strict writer checks -> assembled Lesson body
    -> atomic writer selection/history/current authorization
    -> stop for inspection

Owner-approved fixed plan + evidence + separate frozen expectations
    -> evals/writer.ts -> three fresh writer trials
    -> contract checks + owner semantic review and comparison
    -> explicit writer promotion/non-promotion
```

## Input and output boundaries

`pipeline/stages/writer.ts` ports the approved compact prototype writer prompt.
It adds the approved direct/figurative example requirement and source-reference
usage-note output. Each request carries the headword, planned meaning references,
definitions/POS, exact selected contrast terms with their pinned definitions,
licensed defining-source examples,
assigned usage-note definitions/references and applicable optional origin text.
Owner expectations, full source inventories, excluded quotations, gate rationales and source record IDs
do not enter the rendered request. The private input retains its exact plan and
planner-source mapping.

The shared verified adapter has a fixed JSON-schema wire name, `plan`. The writer
uses that transport name with its own strict Lesson body schema. It does not send
the planner output schema or call the planner. Planner and writer share the
single-response adapter. Historical execution is preserved separately under its
original identities. See [single-response verification](single-response-verification.md)
for the exact evidence contract, persistence and recovery boundary.

Output has one result per planned meaning, three nonempty examples, coaching,
headword-containing single-line patterns, exactly the selected contrasts and
exactly one source-linked note per assigned usage-note source meaning. Unknown,
missing and duplicate output fails. Nullable contrast sides remain legal.
Definition and POS replacements are rejected; assembly reads those fields from
the plan. A non-null origin note requires scoped origin evidence.

Privately retained external quotation texts are compared with all generated text
after punctuation normalization. Known quotation reuse fails the attempt, including
verbatim quotation embedded in a longer field. Quotations never enter the request.
Close adaptations still require human review.

Code checks cannot establish naturalness, grammatical gerund-led coaching,
factuality or metaphor quality. Human review covers those properties, whether
contrasts teach useful differences, and whether patterns and notes are useful.
Creative analogy need not be an established expression. A forced figurative use
should be replaced by another direct example through the approved prompt rule.
There is no model judge or repair call.

## Approved synonym inclusion rule

The owner approved the following rule, recorded in
[#28](https://github.com/cwebley/word-well/issues/28#issuecomment-6083168638):

> Each included synonym must add a distinct, useful reason to choose it. Look
> for a supported distinction first. If two synonyms still give essentially the
> same guidance, keep one. Different labels alone do not make a useful contrast.

A shared individual value, such as the same less-of quality, is allowed when
the rest of the comparison supplies a meaningful distinction. Assess the useful
guidance of the whole comparison. Unique strings in each cell do not establish
distinct guidance, and identical broad source definitions alone do not prove
that two words can never offer different usage guidance.

The owner chose the definitions-only evidence scope in
[#28](https://github.com/cwebley/word-well/issues/28#issuecomment-6084141555).
Select one representative when the selected linked meanings' definitions support
no distinct guidance. This revision does not add contrast usage examples,
supplemental dictionaries or other meanings.

The [approved implementation](https://github.com/cwebley/word-well/issues/28#issuecomment-6084250455)
uses planner-owned, prompt-led selection with pinned definitions for eligible
linked contrast terms. The planner looks for a supported distinction first. If
terms have essentially the same meaning and give the same guidance, it keeps
only the more common or educational one. There is no new human-review step in
the main pipeline or mechanical rejection based on identical definition strings.

Writer input supplies selected OEWN definitions only, and output must include
exactly the terms selected in the Lesson plan. A redundant selection cannot be
resolved by silently dropping a writer row. Historical paid answers and frozen
evaluation sets retain their original contents and identities.

## One source trace

The retained evanescent evidence supplies one adjective source meaning:

```text
s1: tending to vanish like vapor
source example: evanescent beauty
OEWN meaning: oewn-evanescent__5.00.00.impermanent.00
entry: oewn-evanescent-a
concept: oewn-01761452-s
```

1. `pipeline/sources/planner.ts` maps this meaning to `s1`. The pinned bundle,
   source record and relation mappings persist privately.
2. `pipeline/sources/writer.ts` checks a validated plan against that same mapping.
   Each planned meaning gets a request-local `m1` or later reference. Only its
   defining-source examples, selected contrast terms and assigned usage-note
   definitions enter the writer payload. These short references are not stable
   published meaning identities.
3. The origin mapper reads retained candidate Kaikki entries. A unique origin
   with a compatible recorded POS can be supplied. Multiple origin texts or
   origin numbers without a meaning mapping produce a recorded optional absence.
   It does not assume the first origin applies everywhere or refetch during
   rendering. Acquisition errors propagate; they are not converted to absence.
   The actual first-word mapping supplies origin text from retained Kaikki entry
   `line:242376`, identified by raw SHA-256
   `5ab5d9b480e60b88942d232ab081eccba1ed295e6d91108a3449ae0d6f42d455`.
4. `pipeline/stages/writer.ts` renders the strict request for dated Luna,
   OpenAI-only routing and no fallback. `pipeline/execution/openrouter.ts` sends
   once per physical request with SDK retries disabled. The executor saves the
    raw charged completion and selected response headers before interpreting its
    inline evidence. Complete correct routing proof permits content validation.
5. `pipeline/sources/writer.ts` assembles the valid result using planned
   definitions/POS and family selections. Punctuation-normalized copied examples
   retain matching source references. Every example remains flagged for human
   adaptation review, including non-matches. A non-match is not originality proof.
   Generated origin notes retain their separate source-origin support.
6. `pipeline/storage/writer.ts` saves an encrypted result and commits its
   selection, selection history, current planner/gate/writer authorization and
   claim release together. Original generation dependencies remain in the result.
   Publication in #29 must still check exact review, attribution, pronunciation
   and current authorization.

The trace exposes a source-boundary detail: Kaikki entries retain external
quotations, but the writer example list comes only from licensed defining OEWN
examples. Retaining a quotation in import does not make it a generation input.

## Persistence and reuse

Migration `012_lesson_writer.sql` adds immutable encrypted writer reviews and
promotions, writer current authorizations, and writer support in existing trial
and result constraints. It preserves earlier private rows and ciphertexts.
`pipeline/storage/writer.ts` extends the existing store. The single-response repair
changes shared execution identities; evaluated historical code remains frozen.

`pipeline/writer-identity.ts` separates resume compatibility from content reuse.
Writer input includes the exact plan, source mapping, selected evidence and origin
scope. The content identity excludes changing gate/planner result IDs. Unchanged
content can be reused with current authorization while preserving its original
generation dependencies. Changed plan text, evidence or writer configuration
requires fresh writer content. Earlier gate/planner selections remain intact.

## Evaluation and review

`evals/datasets/writer.ts` freezes encrypted immutable inputs and separately held
owner expectations. Approval explicitly covers the fixed plan. Expectations
precede writer-answer inspection. Cases record development/held-out membership;
there is no held-out claim for a development-only case. Each dataset is limited
to ten distinct words; the owner must also retain the approved shared planner and
writer word set rather than silently expand it across versions.

`evals/writer.ts` uses the same stage, executor, adapter and validation as normal
execution. Three fresh trials run for each frozen input, with no planner calls.
Failures and missing trials remain in the denominator. Evaluation never writes
production selections.

`pipeline/writer-promotion.ts` binds owner findings and 1-to-5 comparison scores to
exact saved results. The owner confirms review of examples/coaching, contrasts,
notes and patterns. Factuality, grounding and meaning coverage must pass for every
required trial. Quality has no numeric threshold. Changed validation/review rules
cannot restamp older evidence. Promotion and non-promotion are explicit records.
Review and reporting make zero generation calls.

## Commands

Commands that inspect, freeze or recover existing evidence make no generation calls:

```sh
npm run --silent eval:writer -- freeze --owner-cases <private-approved-cases-file> --directory <private-dataset-root> --version <version>
npm run --silent eval:writer -- dry-run --dataset <frozen-private-dataset-directory>
npm run --silent eval:writer -- inspect <experiment-id>
npm run --silent eval:writer -- recover <experiment-id>
npm run --silent eval:writer -- review --owner-review <private-review-file>
npm run --silent eval:writer -- decision --owner-decision <private-decision-file>
npm run --silent pipeline -- writer run --candidate evanescent --bundle <ready-bundle-id> --dry-run
npm run --silent pipeline -- inspect <writer-run-id>
npm run --silent pipeline -- recover <writer-run-id>
```

Writer generation needs its own explicit owner-approved cap:

```sh
npm run --silent eval:writer -- run --dataset <frozen-private-dataset-directory> --max-cost-usd <approved-cap>
npm run --silent eval:writer -- resume <experiment-id>
npm run --silent pipeline -- writer run --candidate evanescent --bundle <ready-bundle-id> --max-cost-usd <approved-cap>
npm run --silent pipeline -- run --candidate evanescent --bundle <ready-bundle-id> --stage writer --fresh --max-cost-usd <approved-cap>
npm run --silent pipeline -- resume <writer-run-id>
```

The 16,000-token inclusive output cap and shared verified pricing reserve $0.3976
per physical request. Three initial writer trials need $1.1928 of conservative
capacity. Actual charges settle reservations. Transport retries use the same cap.
The earlier planner evaluation budget does not authorize writer calls.

## Failure and rerun paths

- Missing/rejected current gates, missing selected plan or absent production
  promotions stops normal execution before generation. A no-meaning plan never
  reaches the writer. The stage command consumes existing selected prerequisites.
- Invalid output, refusals, truncation or verified wrong routing fails the attempt.
  No fields are dropped and no replacement answer is generated as repair.
- A normal unchanged rerun reuses selected writer content with zero calls. A
  failed fresh attempt preserves the earlier valid selection. Stage-only runs
  stop after writer inspection.
- Missing completion-carried routing proof ends a future trial as
  `verification_unresolved`. Other eligible evaluation trials continue serially.
  Recovery neither queries metadata nor replaces or reopens that trial. Historical
  metadata-only recovery uses the frozen runtime and requires owner authorization.
- Storage/accounting blockage pauses work. Recovery restores known ledger-only
  charges before permission-loss cleanup. Unknown charges remain reserved.
- Revoked permission can terminalize stopped work and release its claim without
  authorizing generation. Ownership is checked around asynchronous setup.
- A failed writer selection transaction leaves no partial authorization or new
  selection. Resume validates the retained attempt rather than sending again.
- Explicit evaluation resume can continue remaining trial identities, retaining
  earlier failed outcomes. Another experiment requires a new budget approval.

## Course comparison

As in the pinned course main, an evaluation task calls shared stage logic and code
scorers inspect actual saved output against separate expectations. WordWell adds
offline private persistence, current permissions, encrypted source/provenance
records, conservative spending, retained verification outcomes and owner semantic review.
Structural validation alone does not establish writing quality.

## Historical verification checkpoint and remaining acceptance

Before the single-response repair, the full local suite passed 384 tests with 12 skipped across 39 files. Typecheck
and whitespace checks passed. The 28 writer tests cover exact contracts, SDK
forwarding, source-example associations, quotation input/output exclusion,
reference-only quotation metadata, origin scope, production reuse and changed
authorization, failed fresh attempts, selection storage failure, metadata-only
recovery, ledger-only accounting restoration, three-trial evaluation, retained
failures and exact owner promotion. Tests use disposable restricted databases.

Migration 012 is applied locally. Comparison preserved all 14,635 inherited rows
across 31 private tables, including ciphertexts. Frozen planner artifacts and
accounting receipts remain unchanged. Saved v4 planner inspection still passes
all three contracts and coverage expectations, with current implementation and
review-rule identities matching the saved experiment. At that checkpoint no live
writer model call, review, promotion or production selection had run.

The actual normal writer dry-run exposed an earlier runtime prerequisite:
`appropriateness_not_current`. PR #33 added Luna metadata-verification types to
`pipeline/execution/model.ts`. Gate reuse hashes that whole interface file, so
unchanged saved Jev results now have a different calculated identity. Restoring
only the earlier interface bytes in a read-only calculation exactly reproduces
the saved identity; gate request/configuration are unchanged. This is tracked in
[issue #34](https://github.com/cwebley/word-well/issues/34). Current authorization
remains enforced. The writer changes do not alter gate/planner implementation
files to bypass it.

Isolated writer evaluation remains independent of this normal-path prerequisite.
The owner approved the fixed plan/evidence and expectations after reviewing the
first-word proposal. Encrypted writer dataset version 1 is frozen and reload
verified, with one development case, no held-out claim and three required fresh
trials. Freezing and dry-run made zero model calls. The dated OpenAI endpoint,
structured-output support and pricing bounds were reverified without generation.
The owner subsequently authorized a separate $1.23 evaluation cap. Owner review,
explicit writer promotion and a normal writer selection remain acceptance work
for #28. Standards and spec review found
no remaining actionable writer findings after the quotation corrections.

## First paid writer evaluation

Experiment `6f0dc00d-6a44-4d65-b3ca-6222cbadceb2` completed the three required fresh
writer trials against the approved frozen dataset version 1. Its experiment ID
was saved before the first dispatch. The fixed plan and expectations were
unchanged; no planner call ran.

All three saved outputs pass deterministic writer contracts. Three intentional
generation requests ran, with no transport retries. Each generation received
four metadata 404 responses followed by a 200 on its fifth read. All 15 received
lookup bodies persist. No separate recovery round or replacement generation was
needed. Authenticated metadata verifies the dated OpenAI upstream and absence of
response-cache reuse.

Total cost was $0.0025236 under the $1.23 cap. Saved accounting receipts match all
charges, with no outstanding reservations or unresolved charges. Network-forbidden
reinspection revalidated the original saved outputs and their tested-rule identity.
Comparison preserved all 14,635 inherited private rows, original ciphertexts,
production selections/promotions and frozen writer artifacts. Evaluation created
no production writer selection, writer review or writer promotion.

The generated lessons and per-trial findings remain private. Owner semantic
review and comparison are pending. This is one development case, with no held-out
performance claim. Normal execution still requires the gate identity repair in
#34 and the separate pending promotion prerequisites.

## Approved prompt comparison

After reading the first paid outputs, the owner approved three compact prompt
refinements: distinct context-driven examples, specific supported contrast
qualities useful for choosing a term, and `not_for` coaching that conflicts with
the definition rather than turning a tendency into an absolute restriction.
The existing three-example direct/figurative fallback, short nullable contrast
sides and fixed planned definitions/POS remain in force.

The revised effective configuration fingerprint is
`74a0c7ed7f87041d6c4136484c386b4ee043ed336f64876fac33cc1395207002`.
The structural configuration schema remains version 1; the changed prompt makes
a distinct effective configuration. Comparison uses the same frozen dataset
version 1, including unchanged owner expectations.

Request comparison verified that only the system prompt changes. Model-visible
evidence, output schema, model/routing, output limit and accounting settings are
identical to the baseline. Network-forbidden baseline reinspection still passes
all three contracts with exact original result fingerprints. The earlier
experiment remains historical evidence under its original configuration and
tested rule; it is not restamped as evidence for the revised prompt.

The 24 existing writer tests, typecheck and whitespace checks pass. Focused
standards and spec review found no actionable issues in the approved prompt
delta. The owner subsequently authorized a separate $1.23 cap for the comparison.
The completed baseline remains the comparison reference.

## Completed prompt comparison

Experiment `848655d0-0279-41d2-89bb-906f204c4c99` completed three fresh trials for the
revised prompt against unchanged frozen writer dataset version 1. The experiment
identity was saved before dispatch. All three saved results pass deterministic
contracts. No planner call or transport retry ran.

The comparison cost $0.0026628 under its $1.23 cap. Combined actual writer cost
across baseline and comparison is $0.0051864. All charges match retained ledger
receipts, with no outstanding reservations or unresolved charges. Metadata
verification used 14 reads across three rounds; no separate recovery round or
replacement generation was needed.

Network-forbidden reinspection revalidated both experiments under their saved
configurations and preserved exact baseline results. Before/after comparison
preserved all 14,649 inherited private rows, original ciphertexts, frozen
artifacts and production selections/promotions. No writer review, promotion or
production selection was created. Human semantic comparison remains pending;
contract passes do not establish that the prompt change improved writing quality.
This remains one development case with no held-out performance claim.

## Approved selected-contrast definition enrichment

After reviewing the prompt comparison, the owner approved supplying the pinned
definitions of only the planner-selected contrast terms. This amends the writer
input boundary. It does not reopen term selection or add an unselected inventory,
contrast examples or owner expectations to the request.

`pipeline/sources/writer.ts` follows each selected term's retained defining-source
contrast links to exact OEWN meanings and matching source headwords. It copies
their definitions and retains all supporting meaning IDs privately. Missing or
blank definitions stop assembly. `pipeline/stages/writer.ts` validates exact term
coverage and complete, duplicate-free target support. Its renderer sends term
names and definition text while keeping source IDs private.

The first-word source trace supplies `impermanent` from
`oewn-impermanent__3.00.00..` and `temporary` from
`oewn-temporary__3.00.00..`. Both pinned definitions are "not permanent; not
lasting". Their `similar` links come from the defining evanescent source meaning.
The identical definitions do not establish different deadlines or philosophical
qualities; semantic review still decides whether any generated contrast is useful
and grounded.

The enriched configuration explicitly recorded
`contrastEvidence: selected-definitions-v1`. Its fingerprint was
`f2e37879093406bbb89048159ac697803cd0a7a05adba1759ea0d59f76eecf64`.
Saved configurations without that field retain historical names-only rendering,
and their frozen inputs may omit definition evidence. Current definition mode
requires it. Both earlier experiments revalidate all six saved results with their
original configuration fingerprints and exact output fingerprints. Historical
inspection makes zero network or model calls.

Encrypted writer dataset version 2 is frozen and reload-verified after explicit
owner approval. Version 1 remains unchanged. Removing only the added contrast
definitions reproduces the complete earlier input exactly. The fixed plan,
selected terms, original evidence and owner expectations are unchanged. The
system prompt, output contract, model/routing and accounting limits are unchanged
from the revised-prompt comparison. This remains one development case, with no
held-out claim.

Four new tests cover selected-definition rendering, missing/duplicate/unsupported
support, historical rendering with current-mode requirements, and exact source
mapping with missing-data failure. Standards and spec review found no actionable
issues. The shared writer target-selection helper resolves a duplication note.
At that checkpoint no enriched-input model call or experiment had run. The next
three-trial comparison required its own owner-approved cap.

## Completed enriched-input comparison

The owner explicitly approved a separate $1.23 total cap on 2026-10-08.
Dataset version 2, configuration, rendered request, implementation and tested-rule
identities matched the approved enrichment preflight. The dated OpenAI endpoint,
structured-output support and pricing bounds were reverified before dispatch.

Experiment `2dad4e00-8c82-44ee-9c96-8d837834e320` completed all three fresh writer
calls. Its identity was saved privately before the first dispatch. The fixed
plan, selected terms, revised prompt and owner expectations remained unchanged.
No planner call ran.

Two of three saved outputs pass mechanical contracts. Trial 3 remains invalid
with `writer_contrast_invalid`: one contrast side contains four words, exceeding
the approved three-word limit. Its charged raw completion and exact failure are
retained. Network-forbidden reinspection reproduces that rejection. No output
was shortened, validation changed or replacement answer generated. This
experiment does not meet the all-required-trials contract bar for promotion.

Cost was $0.002799 under its $1.23 cap. Three intentional generation requests ran,
with no transport retries. Each used four metadata 404 responses followed by a
200 on its fifth read, for 15 retained lookup bodies. Routing verification
confirms the pinned OpenAI upstream and absence of response-cache reuse. No
separate metadata recovery round was needed. All charges match saved accounting
receipts, with no outstanding reservations or unresolved charges. Combined
writer cost across the three experiments is $0.0079854.

Network-forbidden inspection preserves exact new attempts and all six earlier
saved results under their original configurations. Before/after comparison
preserves all 14,663 inherited private rows across 34 tables, including original
ciphertexts. Both frozen writer datasets, both planner datasets, the planner
receipt ledger and inherited writer receipts remain unchanged. No planner/writer
review or promotion and no production writer selection were created.

Generated outputs and assistant semantic comparison remain private. Owner review
and the next contrast-quality decision are pending. This remains one development
case with no held-out performance claim. Normal execution still requires #34 and
the separate planner/writer promotion prerequisites.

## Approved definition-led contrast revision

After reviewing the enriched comparison, the owner approved a contrast-only
instruction revision. Every non-null side must follow from the supplied synonym
and headword definitions. The instructions prohibit inferring planning, a fixed
deadline, suddenness or register from the word alone. A synonym's definition must
not simply be restated as its MORE quality. Unsupported sides must be null, both
sides remain null for near-equivalent words, and non-null sides retain the
one-to-three-word limit. Semantic adherence remains a human-review requirement.

The current effective configuration fingerprint is
`a292272b0318c0457f57eaaa990b68c05b7f9f08c1bffbf2cbb36d3bce11c864`.
Its schema and selected-definition input mode are unchanged. The comparison
retains frozen writer dataset version 2, the fixed plan, selected terms and owner
expectations. No prior generated labels or examples enter the revised request as
demonstration answers.

Request comparison proves that only the contrast instruction changes. The other
system-prompt lines, model-visible input, output schema, routing, token limit and
accounting settings are identical to the enriched experiment. Replacing only
the revised prompt with its saved predecessor reproduces that experiment's
aggregate implementation identity, proving that the other evaluated writer
implementation bytes remain unchanged.

Network-forbidden inspection preserves all nine earlier attempts and their saved
configuration and tested-rule identities: eight valid results and the exact
rejected completion. No old evidence is restamped under the new identities.
Preflight preserves all 14,677 private rows across 34 tables, frozen writer/planner
artifacts and receipt ledgers. The planner v4 implementation and tested-rule
identities still match its saved three passing trials.

The full suite passes 384 tests with 12 skipped across 39 files, including all
28 writer tests. Typecheck passes. Scoped standards and spec reviews found no
actionable findings. The preflight makes zero network or model calls and creates
no experiment, review, promotion or production selection. At that checkpoint,
three fresh trials of this revision required a separate owner-approved cap.

## Definition-led comparison paused for operational diagnosis

The owner subsequently approved a separate $1.23 total comparison cap.
Experiment `5e03c264-95fc-4c35-9d39-f3569def7ca4` was created after dataset,
configuration, request, implementation, tested-rule and endpoint/pricing checks.
Its ID was saved before dispatch. It retains frozen dataset version 2 and the
approved definition-led prompt.

All three generation requests completed and their charged raw responses persist.
Actual cost is $0.0029514, with zero outstanding reservations or unresolved
charges. There were no transport retries or replacement generations. The first
two attempts are valid after same-generation metadata recovery. The third remains
pending because its retained metadata lookups returned 404. This is an incomplete
comparison, not three contract passes or a third content rejection.

The generation endpoint returned each answer successfully, while its separate
generation metadata endpoint initially returned not-found responses. The first
two metadata records later became readable under the same generation IDs. Final
saved evidence contains 44 metadata reads across nine rounds, including six
explicit recovery rounds. Separate diagnostic probes are retained privately.
Observed recovery times do not establish the exact metadata publication delay
or its internal provider cause.

The evaluator returns on the first paused attempt, leaving later trials dependent
on explicit recovery and resume. The owner stopped the agent's shell-sleep and
manual-polling workflow and requested a problem definition and fresh-session
handoff. Further polling and comparison work are suspended. No verification
policy or continuation design has been changed or approved by that request.

Network-forbidden final verification preserves all 14,677 inherited rows across
34 private tables, nine earlier exact attempts, frozen writer/planner datasets
and receipt ledgers. Combined actual writer cost across four experiments is
$0.0109368. There are no owner reviews, promotions or production writer selections.
Private diagnostic artifacts capture the code flow, current state and unresolved
provider evidence and continuation questions. Normal-path blocker #34 remains a
separate prerequisite.
