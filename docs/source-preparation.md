# Prepare pinned public sources

Source preparation makes zero model calls. It downloads public sources, verifies
their bytes, builds a locked Python extractor and retains evidence for later
import. The owner approved unencrypted source files outside Git in
[the #21 storage correction](https://github.com/cwebley/word-well/issues/21#issuecomment-6009072757).
Committed private appropriateness evaluation artifacts retain their encryption.

```text
config/sources.lock.json + hashed Python dependencies
                        |
       verified original downloads and notices
                        |
     OEWN XML validation + complete frequency export
                        |
       Wiktionary XML -> original-page manifest
                        +-> template/Lua working databases
                                      |
                          bounded extraction workers
                                      |
             original entry records + per-page diagnostics
                                      |
                         coverage and mapping review
                                      |
                        later PostgreSQL import, #23
```

## Current acceptance status

The owner approved [small-batch-first lesson development](https://github.com/cwebley/word-well/issues/9#issuecomment-6010729267)
on 2026-10-06. Complete dictionary coverage remains acceptance work for #21, but
the first working lesson may be developed from a separately verified, declared
batch. The fixed `emulate` import and intake path is implemented and verified
locally under #31. Its ready bundle covers only its declared evidence. The
interrupted full-corpus snapshot must not be selected as a ready dictionary or
used to imply complete evidence for a candidate.

The bulk run was intentionally stopped because the owner's laptop cannot run
continuously. Snapshot `d8d3b078bf4c41478d5e9780f832f71e` retains 113,400 committed
dictionary pages and 92,283 records. Its four output/diagnostic checkpoint hashes
were verified after stopping, with zero uncommitted tails. All recorded processes
exited and the preparation lock was released. The current tool reports interruption
as `failed`, not `paused`. Do not automatically restart this run. The original
downloads and completed page/template/Lua databases remain available.

For acquisition alternatives, see [pre-extracted corpus research](research/wiktionary-corpus-acquisition.md).
Publisher downloads avoid local template/Lua expansion. Full-corpus field coverage
and acceptance remain separate from the experimental batch decision below.

The owner subsequently approved a [separate Kaikki acquisition trial](research/kaikki-trial.md).
It finished the full download and an English-only SQLite index in about 8 minutes
23 seconds across the successful stages. The index retains 1,492,836 English
records and 49,551 neutral redirects, with original JSON and line/hash locators.
Its 1,390,507 distinct English words and 1,787,236 source meanings match the
publisher's counts. This establishes a fast acquisition path. The owner then
[approved using the retained raw Kaikki artifact for the experimental small batch](https://github.com/cwebley/word-well/issues/21#issuecomment-6019177076),
without requiring exact equivalence with the local dump/parser result. Preserve
the publisher metadata and file-qualified line/record hashes. Kaikki page/revision
IDs remain unknown; supplemental original-page evidence has its own source
identity and cannot authenticate those records. The fixed `emulate` batch now
has verified mappings and scoped PostgreSQL readiness. Complete corpus mapping
and import acceptance remain separate. The trial has no active job to keep running.

The owner approved `emulate` as the first candidate and the fixed scoped import
contract. [Implementation ticket #31](https://github.com/cwebley/word-well/issues/31)
declares its required evidence and readiness checks. It retains all three OEWN
source meanings, both Kaikki records and all five Wiktionary meanings, direct
frequency, and the linked contrast/family evidence. Scoped readiness and candidate
eligibility remain separate. The import, candidate-build and candidate-explanation
commands use the existing restricted pipeline login. See
[the scoped import guide](scoped-source-import.md) for commands and verified results.

SQLite is the retained acquisition index, not the pipeline database. The scoped
import copies selected evidence into the existing private PostgreSQL schema;
candidate assessments and downstream stage/publication records remain in
PostgreSQL. Under the approved complete-import plan, the derived SQLite index
can be removed after complete verified PostgreSQL import. Original compressed
source bytes and metadata remain external provenance/recovery artifacts.

The native early-path dependencies are #22 local logins, then #31 scoped import
and intake, then #25 production appropriateness and the existing downstream
lesson path. Full-import acceptance remains #23, with its #21/#22 dependencies.
#22 is implemented and verified in local commit `ff66664`; its open issue records
pending remote delivery rather than missing local logins.

Complete-source preparation remains in progress. The downloads and local toolchain are
verified. A complete Wiktionary extraction and its required coverage review have
not been accepted. `verify` reports incomplete work and unresolved diagnostics;
it does not promote a source snapshot automatically.

The initial full-dump attempt was stopped during ingestion to address review
findings. Its `failed` status and partial files remain visible. Those files are
not a complete source result.

A later full-dump attempt exposed a repeated title within one namespace. The
manifest now retains source occurrences by ordinal, page ID and revision ID.
Titles are indexed for lookup, not constrained as unique identities. Conflicts
remain explicit coverage-review work.

## Storage and setup

The default source directory is:

```text
~/Library/Application Support/WordWell/sources
```

Set `WORDWELL_SOURCE_DIR` or pass `--directory PATH` to choose another location.
Paths inside this checkout, including symlinks into it, are rejected. Files use
ordinary local storage. Neither setup nor extraction accesses evaluation keys or
the PostgreSQL database.

The current dependency artifact lock is for CPython 3.14 on macOS arm64. Local
verification used Python 3.14.7 on macOS 15.7.7. An unsupported platform fails
rather than selecting different native wheels.

```sh
npm run pipeline -- sources fetch
npm run pipeline -- sources setup
npm run test:sources
npm run pipeline -- sources extract --workers 4
```

`fetch` retains original URLs, release names, byte counts, publisher checksum
documents, local SHA-256 digests and license notices. OEWN's notices include both
the inherited Princeton WordNet license and Open English WordNet attribution.
The wordfreq wheel retains its bundled source notices.

`setup` verifies the following source commits:

- Wiktextract `d6fca2773bc90b9157248b9edf69585da06bf393`.
- wikitextprocessor `65e1673d15c3b06f1de84d1c34303fc8f68c3528`.
- Scribunto `d35ca1f8d5fd23f1a9915e497cc00cac238f28c4`.

`config/source-python-requirements.txt` pins dependency versions and wheel hashes.
The external `toolchain/lock.json` also identifies the locally built extractor
wheels and pinned NLTK Brown data. Runtime wheels are checked against PyPI's
published hashes. Build records bind reusable extractor wheels to their Git
revision and local digest. Retain these exact artifacts for transfer or recovery.

Four workers are the current starting setting, not a measured throughput optimum.
The adapter submits at most four 25-page batches per worker. It does not load all
pending page bodies into a process-pool queue.

## Files and identities

| File or directory outside Git | What it contains |
| --- | --- |
| `downloads/` | Original OEWN XML, official dated Wiktionary dump and wordfreq wheel |
| `notices/` | Retained license/checksum documents, URLs and content identities |
| `toolchain/` | Python environment, exact wheels, dependency lock, upstream source checkouts and Brown data |
| `extractions/<opaque-id>/state.json` | Selected source lock, toolchain/code/input identities, phase and status |
| `pages.sqlite` | Original dump page text, page/revision IDs, timestamps, source order and resource-selection decisions |
| `resources.sqlite`, `resources_thesaurus.sqlite` | Working template/Lua/page and thesaurus databases |
| `dictionary.jsonl` | English entry records in page/entry order, plus separately recognizable hard redirects |
| `thesaurus.jsonl` | English thesaurus terms with their original extracted relation/scope fields and page identity |
| `frequency.jsonl`, `large_en.msgpack.gz` | Complete English large-list observations and exact original frequency data |
| `*-diagnostics.jsonl`, `worker-*.log`, `extraction.log` | Page outcomes, uncapped structured diagnostics and extraction output |
| `*-checkpoint.json` | Durable batch offsets, prefix hashes, counts and explicit phase completion |
| `resources.json` | Sampled process-tree RSS, allocated source-directory disk bytes and active elapsed time across resumes |

The companion manifest retains original text even when the upstream processor
transforms template bodies. It also retains pages that the resource loader skips.
Wiktextract alone does not retain dump revision IDs.

When titles repeat, both original pages remain in the companion manifest and are
processed as separate source occurrences. The working resource database follows
the pinned processor's last-write-by-title behavior. Its effect must be reviewed;
the adapter does not silently declare conflicting resources complete.

Original entry records preserve gloss paths, tags, topics, forms, directed
relations, examples, quotation metadata, etymologies and pronunciation fields.
Do not flatten a gloss path into unrelated meanings or combine scoped evidence
across entries. Retained quotations are not permission to use them as generated
lesson examples.

The stock thesaurus database can collapse relation/scope distinctions. The separate
term output preserves every returned English term before that database insertion.
Original source pages remain available for checking extraction losses.

Auxiliary interwiki and Wikidata GET responses are captured outside Git. Their
content identities are part of completed artifact evidence. Extraction is not
assumed to depend only on the dated XML dump. No audio/media download is requested.

Content identities use source bytes and recorded versions. Moving the source
directory does not alter them. A database dump does not contain these external
files. #23 will import source evidence and identities; originals, extractor
artifacts and detailed preparation files remain separately stored.

## Checkable frequency trace

The validated frequency export contains this public observation at source order
16,960:

```json
{"form":"emulate","tokens":["emulate"],"storedFrequency":0.0000025703957827688647,"directZipf":3.41}
```

1. `prepare.py` verifies the wordfreq 3.1.1 wheel against its pinned SHA-256.
2. `toolchain.py` installs the retained, hash-locked package and dependencies.
3. `inventories.py` reads English `large`, retains its exact data artifact and
   exports each original form, tokenization and direct observation.
4. The recorded value is the form's own frequency. No inflections or family
   frequencies are summed. Candidate matching and filter assessment happen in #23.

The complete frequency list has 321,180 forms. The OEWN core XML validation found
135,969 lexical entries, 185,129 source meanings and 107,519 linked concepts,
with zero unresolved concept references. These are source observations, not gate
judgments or evidence of a completed Wiktionary extraction.

## Failure and recovery

Inspect status without starting extraction:

```sh
npm run --silent pipeline -- sources status | jq
```

Status writes one JSON object to stdout. `--silent` suppresses npm's script
banner so it does not interfere with `jq`. Errors go to stderr.

To show only the running extraction:

```sh
npm run --silent pipeline -- sources status | jq '.extractions[] | select(.status == "running")'
```

- A download interruption leaves `.part` bytes. Repeat `fetch`. A valid HTTP range
  can continue the download; a server that ignores the range causes a restart.
  Only final size/checksum verification publishes the original file.
- Wrong checksums, unavailable pinned URLs and changed dependency artifacts stop
  preparation. They do not select a newer release.
- Only one preparation command owns the local lock. `status` can read progress
  while it runs. A live owner or surviving extraction process group blocks recovery.
- After a stopped owner, run `sources recover` to remove its stale lock.
- Incomplete ingestion cannot resume merely because a database has rows. Start a
  new extraction attempt. Preserve the failed attempt for diagnosis.
- Completed ingestion and committed extraction batches can resume with unchanged
  inputs using `sources extract --snapshot <printed-id> --workers 4`. Uncommitted
  JSONL tails are truncated to fsynced checkpoint offsets. Changed committed bytes
  stop recovery. Changed extraction code, mapping, source or toolchain inputs
  require a new snapshot. Read-only verification can improve without changing
  the identity of extracted bytes.
- Parsing exceptions remain page failures. All structured diagnostic kinds,
  including debug messages, require impact classification before coverage can pass.
  Upstream exit success is not a completeness decision.

After extraction completes:

```sh
npm run pipeline -- sources verify --snapshot <printed-id>
```

The verification checks artifact identities, English record counts and exact
processed-page coverage. Required field mapping review and unresolved diagnostics
remain acceptance work. Until they pass, the extraction is not ready for import.

RSS is sampled every five seconds and sums the source process tree. Shared pages
may be counted once per process. Disk measurements cover the whole configured
source directory, including retained failed attempts. These measurements exclude
future PostgreSQL data and indexes. A compressed download size is not a disk budget.
