# Import and inspect the fixed emulate bundle

The #31 scoped import and intake path is implemented and verified locally.

```text
Kaikki SQLite records + pinned OEWN/frequency + supplemental original page
                                  |
                       content and scope verification
                                  |
               immutable scoped evidence in private PostgreSQL
                                  |
                  encrypted candidate resolution and intake
                                  |
         explicit ready bundle + current passing intake -> #25
```

## Commands

Apply the additive migration with the saved admin login, then use the pipeline
commands. Import and inspection make zero model calls. They reuse the existing
storage-key identity for encrypted derived records.

```sh
npm run db:migrate
npm run --silent pipeline -- config show
npm run --silent pipeline -- sources import
npm run --silent pipeline -- candidates build --bundle <printed-bundle-id>
npm run --silent pipeline -- candidate explain emulate --bundle <printed-bundle-id>
```

`config/emulate-scope.json` declares the approved source identities and scope.
`config/pipeline.yaml` declares the validated intake policy. Unsupported settings,
unknown options and attempts to disable required policy fail explicitly. Scope
and manifest contents are captured once for import identity and supplied to the
Python reader unchanged. `WORDWELL_SOURCE_DIR` or `--directory PATH` selects the
relocatable acquisition directory.

Import checks the retained artifact bytes on every invocation. Candidate inspection
reads the verified evidence already saved in PostgreSQL. It does not need SQLite,
the original downloads or network access.

## Interruption, failure and repeat behavior

For bounded sessions, add `--limit 1` or another positive unit count to
`sources import`. Artifact locations, source records and checkpoints commit in
short transactions. A bounded session leaves the bundle `loading`; repeat the
same command to resume. An interrupted transaction rolls back its record and
checkpoint together. A later command records an abandoned attempt after acquiring
the database session lock. It does not take over a live importer.

Corrupt artifacts and missing required evidence record a failed attempt with a
fixed diagnostic code and no gate verdict. A failed new bundle leaves earlier
ready evidence intact. Every candidate-build, explanation and downstream intake
authorization requires an explicit bundle ID. There is no automatic fallback.
Ready evidence is immutable, including at the database boundary. Changed source
pins, scope or mapping implementation creates a separate bundle. A changed intake
configuration creates a historical assessment against the same evidence.

## Verified development trace, 2026-10-06

The development bundle is
`33151aac5fdc58d06266eba9a6071adf9f9def58b64ec96d622dbe891c3f7e78`.
It is `ready`, with all 76 units committed. Implementation edits that affect its
identity can produce a different ID on a later import; explicitly select the
bundle appropriate to that implementation.

1. `pipeline/sources/scoped_bundle.py` verifies the retained corpus, SQLite index,
   OEWN artifact, complete frequency export and receipt, original dump and notices.
   It reads Kaikki lines 34324 and 34325, preserving their exact JSON and hashes.
   Publisher page/revision IDs remain null. The separately verified original page
   is 7577, revision 92422846.
2. `pipeline/storage/sources.ts` saves 11 whole entries, 19 mapped source meanings,
   10 concepts and 20 selected typed relations. Three OEWN meanings belong to
   `emulate`; 11 OEWN meanings support its immediate contrasts and family. The
   five Kaikki meanings all enter intake. Linked entries do not create candidates,
   and their other meaning/relation targets remain outside this bundle's coverage.
3. `pipeline/intake.ts` resolves the exact OEWN headword and persists the direct
   frequency at source order 16960, Zipf 3.41. All five configured rules pass.
   Raw `now rare`, including template arguments `now`, `_`, `rare`, remains
   separate from Kaikki's normalized `archaic` tag. The adjective's `obsolete`
   evidence remains in the complete scan.
4. `pipeline/sources/index.ts` exposes `authorizeScopedCandidate` for #25. It checks
   ready evidence and a current config-matching passing assessment, then supplies
   exact headword text alone as appropriateness input. Intake is not a gate result.
   Gate execution, promotion and lesson publication remain downstream work.

The initial import took 6.361 seconds inside the importer. An unchanged repeat
reverified the retained files and reused the same bundle in 7.002 seconds, with
no duplicate evidence. After candidate intake and repeat inspection, the 13 new
source/intake tables and their indexes occupied 720,896 bytes. The whole existing
development database occupied 33,093,299 bytes. These are PostgreSQL measurements;
they exclude retained external acquisition storage. The existing evaluation row
counts and ciphertext-row checksum matched before and after. No login, key or
evaluation record was replaced.

The trace confirms that the computer meaning has no OEWN example and that all
three meanings lack direct synonyms. Seven broader-term contrast associations
provide the recorded support. Neither absence becomes an intake exclusion. The
source-backed generation projection excludes Wiktionary quotations and examples;
whole source records and quotation metadata remain inspectable in private storage.

## Checks

```sh
npm run test:scoped-sources
npm run test:sources
npm run typecheck
```

The scoped suite uses the real import/build/explain entry points in a unique
disposable PostgreSQL database, through provisioned pipeline and learner logins.
It covers one-unit checkpoints, interruption rollback/resume, unchanged repeats,
changed mapping isolation, corrupt bytes, failed required evidence, immutable
ready records, all five intake rules, stable candidate/lesson identity and denial
of every new private table to learner credentials. Harmless mapping cases cover
matching collisions, lexical/nonlexical coexistence, inherited and negated labels,
and explicit versus generic spelling evidence.

The full TypeScript/JavaScript suite passed 267 tests with 12 skipped. The Python
source suite passed 28 tests. Typecheck passed. The implementation was reviewed
against #31 and repository standards, and the actionable findings were corrected.

## Review

### Standards

No documented-standard violations were found. The review identified two correctness
risks, both corrected: the reader now uses captured configuration contents, and a
failed advisory unlock destroys the database connection. Two non-blocking duplication
notes remain about fixed-scope facts and encrypted candidate lookup.

### Spec

Three findings were corrected: artifact locations commit with their checkpoint,
underscore-joined raw qualifiers preserve negation, and the reader honors
`WORDWELL_SOURCE_DIR`. The follow-up review found no unresolved actionable spec
correctness findings.
