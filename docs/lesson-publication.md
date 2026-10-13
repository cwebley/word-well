# Lesson publication

This is the first #29 implementation slice. It assembles controlled review
candidates and exercises the durable publication transaction. It does not load
or authorize live production selections. Live candidates fail with
`publication_live_authorization_unimplemented` before publication writes.
No publication CLI is installed.

```text
saved-material adapter -> assemble.ts -> encrypted candidate
                                      -> encrypted exact review
transaction client -> current authorization adapter
                   -> meaning resolution -> encrypted revision
                   -> explicit public projection -> Practice invalidation
```

## Current interfaces

`pipeline/publication/index.ts` exports the pure assembler and `createPublisher`.
The publisher provides `assembleCandidate`, `getReviewCandidate`, `recordReview`
and `publishCandidate`. Publication accepts only a saved candidate ID and the
expected current publication version. Version zero means no prior publication.

The assembler checks planner/writer contracts, source mappings, selected family
relations, scoped origin and attribution shape. Locators must match the supplied
citation-to-snapshot map. Family locators must identify the recorded relation's
source record. Duplicate citation IDs are rejected. The production adapter must
still establish that this material matches actual pinned source records. It retains the full input,
output, field support, dictionary-example direct matches and the need to review
close adaptations. Candidate identity covers text, evidence, attribution and the
check version. Candidate objects are detached from caller input and frozen.
Missing pronunciation retains a blocked candidate. Unlabelled pronunciation
requires explicit review confirmation; another region is blocked.

Review records name the reviewer, exact identities, decision, findings and time.
An approval with unresolved findings cannot publish. The latest recorded review
controls publication. A new candidate needs its own approval. Changed check
requirements block publication until an applicable implementation rechecks the
candidate and records a new review.

`db/private-migrations/018_lesson_publication.sql` adds immutable encrypted
candidate, review and revision records. It grants the pipeline role public lesson
INSERT and limited UPDATE rights. Learners cannot read the private records.
Normal publication does not use the admin connection.

## Checkable fixture trace

The values below come from `pipeline/testing/publication-fixtures.ts`,
`writer-fixtures.ts` and `planner-fixtures.ts`. They are invented test evidence,
not a source-backed production lesson or an owner-approved evaluation case.

1. `publicationFixture()` supplies the headword `fixture`, the saved definition
   `A thing used in a check.`, the defining reference `s1`, and writer reference
   `m1`. Its source mapping resolves `s1` to `private-source-1` in
   `oewn-fixture-1`. The US pronunciation is `/ˈfɪkstʃər/`.
2. `assembleCandidate` maps the plan definition/POS and writer teaching fields
   into one immutable artifact. The example `The fixture made the check
   repeatable.` matches the pinned dictionary example after normalization. The
   private association is retained. A non-match still requires adaptation review.
3. `createPublisher().assembleCandidate` saves the encrypted artifact in
   `private.publication_candidates`. `getReviewCandidate` reads that artifact,
   without source refetching. The complete material and proposed public fields
   are available for review.
4. The test reviewer `fixture-owner` approves the exact identities. The encrypted
   review persists separately, even if publication later fails.
5. `publishCandidate(id, 0)` loads the candidate, checks review and current
   authorization using one serializable transaction client, and resolves the
   meaning ID. It saves the encrypted revision and writes `fixture-lesson` to
   `public.published_lessons` at publication version 1.
6. The public projection strips source-record locators, generation dependencies
   and example associations. It retains all teaching fields, attribution and
   CC BY-SA 4.0 licensing. The restricted learner connection reads that record.

This trace exposed an important retry distinction. Retrying an already-published
candidate returns its original version; it does not restore withdrawn content
or replace a newer revision. A failed replacement leaves the earlier publication
and Practice bank unchanged.

## Transaction behavior

An advisory transaction lock serializes publication at the stable lesson ID.
The expected version rejects conflicting replacements. PostgreSQL serialization
failures retry saved-record work at most three times, with no generation calls.
A unique candidate key prevents duplicate revisions. An existing public row
without private publication history is rejected, rather than adopted silently.
A stable lesson ID cannot change its normalized headword.

Exact defining source group and POS preserve a meaning ID across wording edits
and reorder. Splits and merges create IDs with predecessor links based on shared
pinned defining sources. Source snapshot identity is part of matching. Equal
source-ID strings across releases do not prove correspondence. Verified
cross-release correspondence remains to be implemented.

The existing lesson-update trigger retires Practice when a meaning disappears
or its definition/POS changes. Example-only edits retain the bank. Retired items
do not revive when old wording returns. These changes commit or roll back with
the lesson and private revision.

`pipeline/publication/publish.test.ts` creates a policy table only in a disposable
database. Its injected authorization adapter reads intake/gate acceptance,
selected dependencies and promotion flags through the transaction client. This
checks the transaction seam, not the production evidence policy. Intake assessment
IDs use the source store's 64-character lowercase SHA-256 format. Gate/result and
promotion IDs remain UUIDs. Tests retain the hash in encrypted revision history
and reject malformed assessment IDs before publication writes. No test policy
table is part of a migration. The tests inject a failure after the public UPDATE
and Practice trigger to verify complete rollback. They also publish a merge,
then a split and a reorder, inspect encrypted predecessor records, and verify
Practice retirement after a POS change.

## Saved generation validation

`pipeline/saved-results.ts` owns the planner/writer run and result schemas and
shared saved-evidence checks. Both coordinators call these checks for reuse and
publication-stage authorization. The functions accept records, not a store or
model adapter. A production publisher can therefore supply records read through
its own transaction client without opening a second connection.

The checks bind the selected result to its original completed run, candidate,
input, bundle, configuration, execution kind, reuse identity and generation
dependencies. A planner run must be accepted for a nonempty plan or rejected for
an empty plan. Valid empty plans remain reusable without new generation, but
cannot authorize writing or publication. Writer runs must be accepted. They also bind the attempt ID/run/stage, input, rendered request,
original provenance, latest saved raw response and interpreted output. Writer
assembly is reconstructed and compared. Original dependencies are checked against
original generation records, never replaced with fresh gate authorization.

For example, the harmless `fixture` input in
`pipeline/testing/planner-fixtures.ts` carries prompt reference `s1`, source
`private-source-1` and the plan definition `A thing used in a check.`. The
saved-evidence unit test builds an accepted run, its selected result and its raw
attempt in memory. Validation reinterprets the raw response and returns the plan.
Changing the attempt's saved input to headword `other` rejects it with
`planner_result_not_valid`, even if its request and interpreted plan are unchanged.
This closes an input-binding gap in the previous planner check. Nothing persists
at this validation boundary; the caller still owns reads and writes.

This extraction is a production-adapter prerequisite. It does not read pinned
source records, current intake/gates or promotions. It does not make the existing
coordinator reads transaction-bound or remove the live-publication block.

## Remaining #29 work

- Load saved live selections and pinned source fields through a production
  assembly adapter. Validate raw attempt/result/configuration provenance using
  the existing coordinator checks, not arbitrary caller-supplied material.
- Implement transaction-bound current intake, gate, dependency and promotion
  checks against durable production records. Only then remove the explicit live
  publication block. Original generation provenance must remain separate from
  fresh gate authorization.
- Implement verified cross-release correspondence and its acceptance tests.
- Connect the complete review display and commands to the saved artifacts.
- Run publisher-to-learner-API/app/history/offline acceptance with harmless
  fixtures. The transaction tests' restricted SQL read is not that acceptance.
- Obtain valid planner/writer production promotions and exact real-content
  approval before any real publication. The retained development example is not
  publication authority.

This slice makes zero model calls. It does not alter retained private evaluation
evidence or authorize paid generation, production publication, commit or push.
