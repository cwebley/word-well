# Local Kaikki acquisition trial

The owner approved this trial on 2026-10-06. Approval and acceptance scope are
recorded in [#21](https://github.com/cwebley/word-well/issues/21#issuecomment-6010869037).
This is an acquisition comparison. The trial does not select a new production
source, change existing pins, or mark any source snapshot ready for normal model
processing.

## Measured result, 2026-10-06

The full publisher corpus was downloaded and its complete English-record index
finished locally. No download or indexing process remains active.

| Measurement | Observed result |
| --- | ---: |
| Download plus final hashing, active sessions | 286.96 seconds |
| Successful index, including saved-cursor replay | 216.07 seconds |
| Completed stages combined | About 8 minutes 23 seconds |
| All source JSONL records scanned | 10,913,997 |
| Original English records retained | 1,492,836 |
| Distinct English words | 1,390,507 |
| English source meanings | 1,787,236 |
| Neutral hard redirects retained separately | 49,551 |
| Other records counted as filtered | 9,371,610 |
| Empty redirect titles retained and flagged | 1 |
| Compressed download | 2,981,058,381 bytes |
| Complete decompressed stream consumed | 25,614,284,530 bytes |
| SQLite index | 3,278,757,888 bytes |
| Download plus index storage | About 5.83 GiB |
| Indexer maximum resident set size | 184,057,856 bytes, about 175.5 MiB |

The successful-stage total excludes time spent developing/testing the adapter,
pauses between commands, the initial 84.9-second failed indexing session and
separate integrity checks. The retained failed index adds about 1.94 GiB; the
whole trial directory occupied about 7.78 GiB when measured. Existing original
source preparation files remain separate.

The distinct-word and meaning counts match Kaikki's published English website
counts. This supports retention of the publisher's English records; it does not
independently prove completeness against every original Wiktionary page.

Artifact identities:

```text
raw-wiktextract-data.jsonl.gz
SHA-256 3dac8a09e57827bef493e2e6b552fe917bf3b1fc55dee05c4e4a3702aff5dbdb

english.sqlite
SHA-256 e52f72a5a4428369cbf59bbfc458630ef14c45b7d7092e62983f81fc03932592

indexer code
SHA-256 e5c828219ed866edb9fd771795f51826783a4c78ece46094982add87cd4cd19d
```

The real download was stopped after 469,762,048 committed bytes, then resumed
from the next range. The corrected index was paused at 100,000 source records
and completed from that cursor. Every retained record's original-JSON hash was
checked. SQLite `quick_check` returned `ok`, and rerunning the completed index
preserved the complete database hash and counts. All 25 source tests passed.
The trial made zero model calls and no PostgreSQL import.

The [completed trial evidence](https://github.com/cwebley/word-well/issues/21#issuecomment-6011213319)
is recorded in #21. The owner subsequently
[approved Kaikki adoption for experimental small-batch lesson development](https://github.com/cwebley/word-well/issues/21#issuecomment-6019177076).
Exact equivalence with the local dump/parser result is no longer an adoption
prerequisite for that batch. Keep the retained publisher/file/record identities
and identify supplemental original-page evidence separately. The fixed `emulate`
batch now has verified fields and a ready scoped PostgreSQL bundle. See
[the scoped import guide](../scoped-source-import.md) for commands and measured
results. Adoption and scoped readiness do not certify full-corpus coverage or
authorize model execution.

The approved first candidate and scoped PostgreSQL import/readiness contract are
specified in [#31](https://github.com/cwebley/word-well/issues/31). The SQLite index
remains a reusable acquisition artifact. Production pipeline state stays in
PostgreSQL; the index becomes removable after complete verified PostgreSQL import.
Retain the original compressed corpus and metadata separately for provenance and
recovery.

```text
Kaikki raw JSONL.gz + retained publisher metadata
                 |
    range download with fixed remote identity
                 |
     retained bytes + local SHA-256 identity
                 |
     stream gzip and keep whole English records
                 +-> retain neutral hard redirects separately
                 |
    SQLite records + transactional stream checkpoint
                 |
     compare emulate, colour, tee and café
```

## Commands and storage

Run from the checkout:

```sh
python3 pipeline/sources/kaikki_trial.py fetch
python3 pipeline/sources/kaikki_trial.py index
python3 pipeline/sources/kaikki_trial.py report
```

The default directory is outside Git:

```text
~/Library/Application Support/WordWell/sources/trials/kaikki-20261006
```

Each command accepts `--directory PATH`. The comparison currently reads the four
existing local samples from snapshot `d8d3b078bf4c41478d5e9780f832f71e` under the
default source directory. It makes zero model calls and does not use PostgreSQL.

| File | Contents |
| --- | --- |
| `publisher.html` | Retained publisher page and its recorded digest |
| `download.json` | Published parser/dump dates, URL, remote ETag/size, chunk hashes, final local artifact identity and measured session time |
| `raw-wiktextract-data.jsonl.gz.part` | Incomplete compressed download |
| `raw-wiktextract-data.jsonl.gz` | Completed compressed corpus, retained for repeat use |
| `english.sqlite` | Original English JSON lines and neutral redirects, source line ordinals, decompressed byte offsets, per-record hashes and committed progress |
| `index.json` | Last successful indexing command's progress summary; SQLite is authoritative after an interruption |
| `comparison.json` | Trial counts, measurements, whole sample records, field summaries and separately identified local sample references |
| `field-comparison.json` | Deep sample field comparisons and exact observed differences |
| `integrity.json` | Whole-index identity, all retained-record hash checks and count accounting |

`English` here means `lang_code == "en"`. Neutral hard redirects are a separate
record kind. Other records are counted as filtered, including a separate count
for unrecognized language-neutral records. No JSON object is flattened or merged.
Duplicate words remain separate source occurrences in line order.

The publisher contains a neutral redirect at source line 4,715,847 with an empty
title and target `Appendix:Control characters`. The initial index attempt stopped
on that record. Its incomplete database is retained in `failed-index-v1/`.
The corrected index retains the original redirect under its line ordinal/hash and
counts `emptyRedirectTitles`; it does not manufacture a headword. A regression
test exercises this exact source record. Indexer-code identity changes require a
new index, so the corrected trial rebuilds from the retained download.

## Interruption and repeat behavior

Closing a terminal, sleeping and shutting down have different process behavior.
The commands do not prevent laptop sleep. Stop the active trial process with
Ctrl-C or SIGTERM when convenient, then repeat the command later.

- Download chunks commit every 32 MiB. A resume verifies saved chunk hashes and
  discards only an uncommitted tail. Requests require the retained remote ETag and
  exact byte range. A changed publisher file stops the trial rather than mixing
  old and new bytes. Preserve that attempt and select another trial directory.
- After a completed download, `fetch` verifies and reuses local bytes without a
  network request. The SHA-256 identifies our retained file; it is not a claimed
  publisher cryptographic checksum.
- Index records and their progress cursor commit in one SQLite transaction every
  10,000 source records. A stopped command rolls back the uncommitted batch.
  A resume checks the compressed artifact and indexer-code identities first.
- Gzip does not offer cheap arbitrary seeking. Index resume replays decompression
  up to the saved cursor, then continues parsing. It does not rerun Wiktionary
  templates or Lua. Replay time is recorded separately.
- To use bounded indexing sessions, add `--limit 100000`. Repeat that command
  until the recorded index is complete, or finish with an unlimited session.
- A completed index command reuses its saved records. Invalid JSON, invalid
  record shape, missing English word identity or gzip corruption stops the command;
  an incomplete corpus never receives completed index status.

If shutdown leaves a stale preparation lock in the trial directory, recover it
before repeating the command:

```sh
python3 pipeline/sources/prepare.py recover \
  --directory "$HOME/Library/Application Support/WordWell/sources/trials/kaikki-20261006"
```

Recovery refuses a live owner. This trial lock is separate from the stopped
full-extraction lock. Do not start two writers in the same trial directory.

## Verification

```sh
python3 -m unittest discover -s pipeline/sources -p test_kaikki_trial.py -v
npm run test:sources
```

The trial checks cover changed remote bytes, committed-byte corruption,
interrupted download tails, interruption between rename and metadata publication,
transactional index resume, duplicate-safe repeat, redirect preservation and
malformed-record failure. Full source acceptance remains separate work.

The acquisition's source/provenance limitations are documented in
[the publisher research](wiktionary-corpus-acquisition.md). In particular, the
local original-page manifest cannot authenticate this different publisher extract.

## Sample evidence comparison

The sampled counts match the existing local extraction:

| Word | Entries | Source meanings | Sound records | Origin records |
| --- | ---: | ---: | ---: | ---: |
| emulate | 2 | 5 | 8 | 2 |
| colour | 3 | 3 | 3 | 0 |
| tee | 6 | 12 | 42 | 6 |
| café | 1 | 2 | 7 | 1 |

The nested meaning objects match exactly for `emulate`, `colour` and `tee`.
Sound/form records, origin text/templates, head templates and the sampled relation
fields match for all four words. The publisher adds `etymology_links` for
`emulate`, `tee` and `café`.

The `café` meaning objects differ only in the `error-lua-exec` tags present in the
local sample and absent in the publisher sample. Its publisher entry contains
204 translations versus 202 locally. This is a sample difference, not proof that
all publisher Lua errors are resolved.

Two known mapping gaps remain:

- `emulate` retains `(now rare)` in its raw gloss, but the normalized tag is
  `archaic`. Raw qualifier evidence and normalized classifications must remain
  distinguishable.
- All three `colour` entries retain the gloss `Commonwealth and Ireland standard
  spelling of color.`, but no meaning has an `alt_of` or `form_of` field. The
  explicit original spelling template is not supplied in those meaning objects.
  Definition-text inference cannot replace the approved source-backed spelling
  rule.

`field-comparison.json` outside Git binds the deep comparison to the downloaded
artifact SHA-256, per-record hashes, source line ordinals and separately identified
local sample references. It does not authenticate publisher records with the
local revision IDs or establish corpus-wide field completeness.
