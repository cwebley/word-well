# Evanescent scoped source import

The #32 path imports the selected evanescent evidence from retained files.
The initial source-import checkpoint produced a ready bundle and passing factual
intake. Its dry-run had no selected production result for either gate and made
zero model calls. Later planner work is recorded in [lesson-planner.md](lesson-planner.md).

```text
retained OEWN + complete Kaikki index + original page + direct frequency
    -> immutable one-word bundle in private PostgreSQL
    -> encrypted resolution and all five factual intake outcomes
    -> dry-run with evanescent and recorded OEWN POS a
    -> new explicit gate budget required
```

## Commands

Use the existing pipeline login and storage key. The acquisition directory is
relocatable through `WORDWELL_SOURCE_DIR` or `--directory`.

```sh
npm run --silent pipeline -- sources import --scope config/evanescent-scope.json
npm run --silent pipeline -- candidates build --bundle <printed-bundle-id>
npm run --silent pipeline -- candidate explain evanescent --bundle <printed-bundle-id>
npm run --silent pipeline -- run --candidate evanescent --bundle <printed-bundle-id> --dry-run
```

`config/evanescent-scope.json` is a separate immutable scope. The existing emulate
scope and saved bundle remain available. No bulk extraction or index rebuild is
part of these commands. `--limit 1` checkpoints a bounded import; repeating the
same scope resumes it. An unchanged ready import reverifies the artifacts and
adds no duplicate source or intake evidence.

## Verified source and intake trace, 2026-10-07

1. `pipeline/sources/scoped_bundle.py` verifies the retained artifact digests,
   complete Kaikki-index receipt and full frequency export. It reads OEWN entry
   `oewn-evanescent-a` at entry order 53764, preserving POS `a`. Its only source
   meaning is `oewn-evanescent__5.00.00.impermanent.00`, concept
   `oewn-01761452-s`, definition `tending to vanish like vapor`, example
   `evanescent beauty`.
2. The reader selects every English Kaikki entry for the exact headword. There is
   one adjective record, line 242376, raw SHA-256
   `5ab5d9b480e60b88942d232ab081eccba1ed295e6d91108a3449ae0d6f42d455`.
   Its six meaning objects retain complete gloss paths, topics, raw qualifiers,
   quotation metadata, pronunciation, etymology and form evidence. Publisher
   page and revision IDs remain null.
3. The original-page companion is page 64368, revision 92133237, timestamp
   `2026-08-23T18:06:03Z`, text SHA-256
   `eac73dd56ee2ce1f6845930c7a842ab8859457462e7dd5c98c47569f1138b8d2`.
   The page mapper keeps definition paths `[1]`, `[1,1]`, `[1,2]`, `[2]`, `[3]`
   and `[3,1]`. It stops at the next language heading, Catalan. This page does
   not authenticate the separate publisher extraction.
4. `pipeline/storage/sources.ts` saves six whole entries, eleven mapped source
   meanings and four concepts. Five meanings are OEWN records, including the
   candidate and immediate linked support; six are Kaikki records. Nine selected
   typed relations include OEWN contrasts `impermanent` and `temporary`, OEWN
   family links `evanesce` and `evanescence`, and five Kaikki Derived terms.
   Linked entries remain support, not additional candidates. Their other targets
   are outside this bundle's coverage. All 46 import units committed.
5. `pipeline/intake.ts` resolves the exact headword and uses its own frequency
   observation at order 79805. The direct token is `evanescent`, stored frequency
   `1.4125375446227555e-7`, Zipf 2.15. Source matching, frequency, prohibited
   labels, entry form and spelling all pass. Electromagnetism, mathematics and
   botany qualifiers remain in the scan, with normalized topics distinguished
   from raw qualifiers. Broad topics do not trigger a speculative exclusion.
6. Complete entry and page inspection found no explicit nonpreferred-spelling
   claim. The empty spelling evidence is bound to the exact reviewed page and
   complete Kaikki-record hashes in `pipeline/intake.ts`, with source references
   in the saved outcome. An unreviewed page or missing record leaves this check
   unresolved. A hash alone from an arbitrary new scope does not authorize it.
7. `pipeline/sources/index.ts` saves encrypted candidate resolution and assessment
   through shared storage. Its current-intake authorization projects exactly
   `{ "headword": "evanescent" }` for appropriateness and
   `{ "headword": "evanescent", "partsOfSpeech": ["a"] }` for usefulness.
   The generation projection contains the one candidate OEWN meaning. It does
   not promote the six Kaikki meanings into the lesson inventory or send their
   quotations as generation examples.

The trace exposed a word-family detail. Kaikki's Derived terms include
`multiple evanescent white dot syndrome`. It remains a recorded source relation,
not automatic lesson content or a new candidate. Planner validation and
review still decide which supported family candidates belong in the lesson.

## Initial source-import checkpoint

The ready bundle is
`4d84648896fd8a734d5742c833a0e370a0a4664f5d22cdc9789c1e5e67ee389d`.
The current intake assessment is
`abe9ee830daa7c26f2d8be60d78aaa73524e650c37acae50ebfb77d3b5cc4b68`.
The initial import took 6.320 seconds inside the importer. The unchanged repeat
took 9.542 seconds, reused the same bundle and reproduced both current intake
assessment identities. It added no duplicate source or intake evidence.

The initial real dry-run used normal mode and stopped after usefulness. Both gate
promotions were verified under their current identities. Both selected result
IDs for evanescent were null at that checkpoint. This established factual intake readiness, not gate
acceptance or permission to generate a lesson.

Intake interpretation changed, so emulate received a new current factual
assessment against its original ready bundle. Historical assessments, both gate
promotions, emulate's existing production selections and all evaluation history
remain saved. No model judgment was repeated. Development preservation checks
compare inherited rows byte-for-byte through their row digests, including
ciphertexts, and verify unchanged saved usefulness dataset and answer artifacts.
Private operational gate evidence remains outside Git and public issue comments.

## Failure, repeat and isolation checks

- A loading bundle cannot authorize a candidate. Record/checkpoint transactions
  retain the existing interruption rollback and resume behavior.
- An explicit candidate from the other bundle returns
  `candidate_outside_bundle_scope`. OEWN linked POS values never enter the gate
  subject.
- Missing required evidence or corrupt artifact bytes record an import failure.
  A failed new scope leaves both earlier ready bundles usable. No automatic
  fallback selects one.
- Changed source or mapping bytes produce a new bundle identity. Changed intake
  interpretation requires a new current assessment and retains the old one.
- A factual exclusion or unresolved prerequisite stops before live gates. A later
  paid run still requires its own explicit budget and both existing promotions.

The scoped suite uses unique disposable migrated databases and actual restricted
logins. It covers both subjects, nested definitions, quotation retention,
source/reference isolation, bounded progress, rollback/resume, unchanged repeats,
failed-new-bundle isolation, immutable readiness and denial of all source/intake
tables to learner credentials.

```sh
npm run test:scoped-sources
npm run test:sources
npm run typecheck
```

The scoped suite passed 14 tests. The Python source suite passed 30 tests. The
full TypeScript/JavaScript suite passed 304 tests with 12 skipped, using the
original saved emulate bundle for coordinator fixtures in disposable databases.
Typecheck and whitespace checks passed.

## Review

The standards review found no documented-standard violations. It noted possible
duplication in the candidate-entry selection predicates used by intake,
generation and gate projection. This is a non-blocking maintenance note. The
spec review found no actionable missing requirements, scope creep or correctness
findings against #32.
