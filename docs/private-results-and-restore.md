# Saved results and local restore

These operations read saved evidence. They do not generate new model replies.

```text
Encrypted PostgreSQL records + Keychain identities
                  |
         Read-only results reader
            /             \
   Local report         Finalize
   real words shown     aggregate JSON + database digest
                              |
                      Separate exporter
                      one Braintrust summary row

wordwell_dev -> pg_dump -> age -> temporary snapshot.age
                                      |
                              decrypt in memory
                                      |
                             pg_restore over stdin
                                      |
                         throwaway database -> same reader
                                      |
                          drop database + remove snapshot
```

## Files and boundaries

| File | Input and result | What persists |
| --- | --- | --- |
| `evals/private-local.ts` | Loads public key references from `keys.json`, verifies their Keychain identities, opens the selected database | Nothing new |
| `pipeline/storage/postgres.ts` | Reads encrypted records, decrypts them and verifies their embedded row and key identities | Reading changes nothing |
| `evals/private-appropriateness.ts` | The reader reconstructs cases, trial details and scores. `finalize` builds the fixed summary under an experiment lock | Finalization writes aggregate JSON and records its digest and timestamp in PostgreSQL |
| `evals/private-report.ts` | Turns reader results into escaped HTML on `127.0.0.1`. The printed session link sets a cookie through an HTTP header, then redirects to the report | No deliberate page, log or result-file writes. The browser manages a session-token cookie |
| `evals/summarize.ts` | Validates fixed aggregate fields and count denominators; rejects extra fields and free text | The aggregate file written by finalization |
| `evals/export-summary.ts` | Receives only the summary file and Braintrust credentials. Uses a deterministic experiment name and row ID | One remote summary row and a local acknowledgement receipt |
| `scripts/rehearse-private-restore.ts` | Pipes Docker's `pg_dump` through the age CLI. Decrypts the snapshot with the storage identity in memory and feeds Docker's `pg_restore` | An encrypted temporary snapshot and throwaway database. Cleanup attempts to remove both on completion or failure; failed cleanup may require manual removal |

The report shows real words, owner expectations, reasons and saved replies.
It has no JavaScript or external resources, and its responses disable caching.
The cookie contains only a random session token. Restarting the server invalidates
the old token. Stopping the server does not erase a page already rendered in a
browser.

## One actual saved example

The restore rehearsal on 2026-10-05 viewed experiment
`8dbb48c5-42d1-47e1-901d-c7330fe1a720` twice through the restored report. This is a
public five-word smoke run, configuration `v4`, not an owner-authored evaluation.
The following values were read from its saved records, without model calls.

1. `private-local.ts` resolves `ww-storage-v1` and `ww-dataset-v1` against
   Keychain. The database dump contains neither identity. Frozen evaluation
   artifacts also remain separate from the dump.
2. `postgres.ts` decrypts the experiment, cases, expectations and saved trials.
   For the public word `exuberant`, the stand-in expectation is `clear`. All
   three trials are valid, with blocked probability `0.01`, slur probability
   `0.05`, and disposition `accept`. Nothing is rewritten.
3. The reader in `private-appropriateness.ts` applies the saved thresholds to
   those saved results. The report shows the same values. Across the smoke
   experiment there are five passing cases, 15 valid trials, zero missing
   trials and known cost $0.000402822. These are smoke results, not promotion
   evidence.
4. **If the owner finalizes this experiment**, `finalize` would write
   `private-evaluation/summaries/8dbb48c5-42d1-47e1-901d-c7330fe1a720.json`
   under the WordWell Application Support directory. It contains counts,
   identities, purpose `smoke`, rates, timing and cost. It does not contain
   `exuberant`, its case ID, its reason or any raw reply. The database would
   record the summary digest and finalization time. This rehearsal did not
   finalize it.
5. **If the owner exports that finalized file**, `export-summary.ts` would
   upload one aggregate row, using the experiment UUID as the row ID. Its
   import graph has no private reader, keys, database or model client. This
   rehearsal made no export.
6. The recovery script restored all 20 experiments, including this one, and
   compared their decrypted case results and status against the source. It
   also decrypted all 1,305 saved score records. Source and restored database
   rows remained unchanged after reading.

## Run the local recovery check

Prerequisites are the existing local Docker database, both existing Keychain
identities, the committed frozen dataset artifacts, and `~/.local/bin/age`.
The command does not load `.env` or initialize a model adapter.

```sh
docker compose up -d --wait
npm run db:setup
npm run eval:private:restore-check
```

The script is limited to `wordwell_dev` on the local Compose port `54329`,
using the admin connection from `.env.database`. It generates a unique throwaway
database name and prints that name and its temporary directory before dumping.
Only the encrypted snapshot is written to disk. The decrypted archive stays in
process memory and a pipe to `pg_restore`.

The check compares every public and private table's row count and content
digest, migration history, ownership, effective schema/table grants and default
grants. It connects as `wordwell_learner_login`, verifies public lesson reads, then
requires permission denial for all six private tables. It loads the frozen
evaluation artifacts and compares their identities, keys and case content with
restored records. It reads every restored experiment with `wordwell_pipeline_login` and requests the report
page twice. Any `fetch` request is blocked and counted; the expected count is
zero. Database snapshots must still match afterward.

### Verified result on 2026-10-05

- 20 experiments, 1,344 case records and 1,305 saved scores recovered.
- Six frozen evaluation artifacts resolved through the dataset key.
- Nine migration records and all compared rows and effective grants matched.
- The learner role was denied reads of all six private tables.
- Two report views, zero model requests, unchanged source and restored rows.
- No throwaway restore databases or encrypted snapshots remained after cleanup.

### Reverified with actual logins for #22

After the login and counter migrations, the rehearsal recovered the same 20
experiments, 1,344 case records and 1,305 saved scores. All 11 migration records,
rows and effective grants matched. The actual learner login was denied all six
private tables. The pipeline login read restored evaluations and served two
report views with zero model requests. Cleanup removed the temporary database
and encrypted snapshot. Repeating local setup preserved the six private tables'
counts and full-row digests captured before these migrations.

The trace exposed one historical exception. Experiment
`0d89389e-87c7-4ff5-8063-85c59d27c6d2` contains the five public smoke words, but
has no saved purpose field. The current reader defaults that missing field to
`evaluation`. This run predates the CLI's recording of smoke purpose.
Its temporary dataset is gone. The script recognizes only this exact record,
checks its five distinct public smoke inputs and clear stand-in expectations,
and reports it separately. It does not relabel or change the record. Six other
experiments have explicit smoke/audit purpose and intentionally temporary
datasets. Their saved results are recovered, but their deleted temporary
artifacts cannot be recovered from the database dump.

PostgreSQL also changed the private schema's explicit owner-only grant into an
equivalent default grant on restore. The check therefore compares effective
grants rather than treating a null grant array as a permission change.

## Failure and rerun

| Situation | What to do |
| --- | --- |
| Keychain, age, dump or restore fails | The command exits with a fixed error code and attempts cleanup. Fix the local prerequisite and rerun. It never substitutes a plaintext dump |
| A store close, pool shutdown or temporary-material removal fails | Every remaining cleanup step is still attempted. The command exits with `restore_cleanup_failed`; use the printed database name and directory for manual cleanup before rerunning |
| Rows, grants, artifacts or decrypted results disagree | The check fails. Investigate the mismatch before accepting recovery |
| Another process writes to the source during rehearsal | The before/after comparison fails. Rerun when the source is idle |
| Report session is missing or wrong | Open the printed session link. A report failure returns a fixed code, not the private exception |
| Finalize is repeated | It recreates the same summary and checks its digest. A conflicting digest fails |
| An incomplete or failed experiment is finalized | The summary records that state and cannot pass. Resume unfinished work before finalizing; afterward, fresh judgments need a new experiment |
| Export fails or its acknowledgement is lost | Retry the same frozen summary. The same remote experiment and row identities are reused |
| Export already has an acknowledged local receipt | It returns that receipt without another upload |
| Export receives a conflicting summary | It stops with `export_conflict` |

The dump restores into the existing local PostgreSQL cluster, where
the admin, learner and pipeline logins and their grant roles already exist.
`pg_dump` does not include
cluster roles, Keychain identities, dataset files, the accounting ledger,
aggregate files or export receipts. Those dependencies need separate handling
for a future cloud move.

The learner-login pool closes after its permission checks. The rehearsal also
revokes public database creation and temporary-table permissions on the restore
database, because restoring without `--create` does not restore database-level
ACLs. Store closes, pool shutdowns,
database deletion and directory removal are attempted independently. The command
prints `temporary_material_removed` only when all cleanup steps succeed.

If cleanup reports `restore_cleanup_failed` or the process is forcibly stopped
before cleanup, use the exact database name and directory printed by that
invocation. Substitute those two values below. Either may already be absent:

```sh
RESTORE_DB=wordwell_restore_<printed-suffix>
RESTORE_DIR="<printed-temporary-directory>"
docker compose exec -T postgres dropdb -U wordwell --force --if-exists "$RESTORE_DB"
rm -rf -- "$RESTORE_DIR"
```

## Report leak checks

`evals/private-report.test.ts` uses a throwaway database and harmless markers
in a word, owner reason, raw reply and injected exception. Through real HTTP
requests it verifies display and escaping, session access, cross-site refusal,
no-cache headers, refresh and zero model calls. It verifies that an exception
returns only `report_failed`, that captured console output has no markers, and
that files in the controlled private workspace are unchanged and contain no
plaintext markers.

No Playwright report check is included. Browser storage and outgoing browser
requests have not been observed in this rehearsal. The script-free page and
resource restrictions are verified from the implementation and HTTP response.
The test does not prove the absence of every possible system temporary file or
OS/browser memory write to disk.
