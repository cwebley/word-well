# Private appropriateness authoring

Implemented for [issue #14](https://github.com/cwebley/word-well/issues/14).
This workflow enters, saves, approves, assigns, and freezes cases locally. It
needs no database or model credentials and makes no model calls. Case collection
and evaluation remain the later owner-execution work in issue #17.

The owner [approved optional reasons](https://github.com/cwebley/word-well/issues/14#issuecomment-5984954383)
for saving, approval, and freezing. This amends the earlier required-reason contract.

```text
Browser form on 127.0.0.1
    -> exact headword + owner finding + optional private reason/provenance
    -> one save: firm label = content-bound approval, plus the chosen split
    -> age-encrypted workspace outside the checkout
    -> immutable encrypted dataset directory in evals/datasets/
```

## Local setup and start

Requires macOS, Node 20 or newer, Swift with the macOS Security framework, and
age CLI **v1.3.2**. The TypeScript age implementation is pinned to
`age-encryption` **0.3.1** in `package.json` and `package-lock.json`. Interoperability
tests cover both encryption directions with the pinned CLI.

Install the exact CLI with Go, then put its installation directory on PATH:

```sh
go install filippo.io/age/cmd/age@v1.3.2
export PATH="$HOME/go/bin:$PATH"
age --version
npm ci
npm run eval:author -- setup
npm run eval:author -- start
```

Open the session URL printed by `start` in a browser. Treat this URL as a local
session credential. Ctrl-C stops the server. Each start creates a new session.
The default port is chosen by the OS. To select one, add `--port 4317`.

The default private directory is:

```text
~/Library/Application Support/WordWell/private-authoring/
  keys.json       Safe local key references and opaque workspace identity
  workspace.age   Encrypted cases, approvals, splits, and workspace revision
```

An alternative directory can be selected with `--private-dir <directory>` on
setup, start, and recovery. It must be outside the checkout with owner-only
directory permissions. Path checking resolves existing symlinks before creating
anything. Private files have mode 0600. The workspace file is never plaintext.

`setup` creates or reuses two native age X25519 identities in macOS Keychain.
Their service is `org.wordwell.private-age`. Their accounts are
`ww-storage-v1` and `ww-dataset-v1`. Swift passes identities through anonymous
pipes to and from the Security framework. They never enter command arguments,
console output, or deliberate files. Setup does not replace or delete an existing
Keychain item. Keep old versioned identities while ciphertext references them.

Start verifies both identity-to-recipient associations and the pinned CLI before
opening a browser session. A missing, locked, inaccessible, or mismatched key
stops startup. Key access is checked again during reading and saving. No key
failure permits a plaintext fallback.

## Browser workflow

The owner [approved one-step authoring](https://github.com/cwebley/word-well/issues/15#issuecomment-5989103199)
on 2026-10-05. Saving a firm label is the content-bound approval, and the same
save can assign the split.

1. Enter the exact headword and choose `clear` or `blocked` yourself; no finding
   is preselected. A short reason and source provenance are optional.
2. "This is a firm owner label" is ticked by default. Untick it for an uncertain
   exploration draft, which has no approval or split and is never scored.
3. Choose **Development**, **Held-out**, or **Not yet**. If you have already seen
   model answers for the word, tick "I have already inspected model answers". The
   case and its spelling variants can then only enter development, even after edits.
4. For a close spelling variant of an existing case, choose that case's variant
   group. Case, punctuation and accent-normalized variants connect automatically,
   and connected variants must stay on one side of the split.
5. Click **Save case**. One encrypted write stores the case, records approval of
   exactly this content, and assigns the split. The success message names the split.
   If the split is not allowed, for example held-out for an inspected word,
   nothing is saved and the form keeps your input.
6. **Edit case** reopens a saved case with its current split selected. Saving a
   content change records a new approval and keeps the selected split. Unticking
   firm turns the case back into a draft and drops its split.
7. To move cases between splits, change any number of radios in **Saved cases**
   and click **Save split changes** once. All moves are saved in one encrypted
   write. If any move is not allowed, nothing is saved and your selections stay.
8. Check coverage. The planned set is 20 development and 20 held-out, roughly
   balanced clear/blocked. These counts are a target, not a reason to force a label.
9. Freeze with a new integer version. Only firm, approved, split-assigned cases
   enter the frozen set. While any firm case has no split, the page names how many,
   and freezing refuses unless you tick "Leave out the … firm cases without a split".

The app uses ordinary HTML forms with no JavaScript. Values are escaped as text.
There are no external resources, analytics, exports, localStorage, sessionStorage,
IndexedDB, service workers, or browser caches. Responses disable caching. Session
cookies are HttpOnly, SameSite=Strict, and have no persistent expiry. A secret URL
opens the initial session; later reads require its cookie. Writes also require a
CSRF token and exact Origin and Host checks. The server binds only to 127.0.0.1.

Plaintext necessarily exists in browser and process memory during entry and
review. OS and browser memory may reach disk. Stopping the server ends that
session's access but does not erase a page already rendered. Close the page when
finished. The implementation creates no deliberate plaintext draft or HTML file.

## Implemented files

```text
evals/
  private-authoring.ts          Setup/start/recover command and key verification
  authoring/
    records.ts                 Private schemas, approval, variants, coverage
    store.ts                   Encrypted workspace and immutable dataset loading/freezing
    server.ts                  Loopback sessions and protected native form operations
    page.ts                    Script-free escaped HTML form
    fixtures.ts                Harmless in-memory test identities and cases
    interruption-worker.ts     Test-only killed-writer harness
    store.test.ts              Storage, identity, failure, split, concurrency tests
    browser.test.ts            Actual Chromium and optional Keychain/process-restart tests
    isolation.test.ts          Transitive import check for zero model/database/telemetry clients
  datasets/
    appropriateness-v000001/   Created by freeze, not supplied as real cases
      cases.age                Dataset-key ciphertext only
      manifest.json            Strict safe metadata only
pipeline/storage/
  crypto.ts                    Reusable age records and embedded identity checks
  keychain.ts                  Versioned native Keychain identity operations
  keychain.swift               Security-framework pipe helper
  files.ts                     Durable replacement, locks, stopped-owner recovery
  crypto.test.ts               Wrong-key, corrupt, truncated, and CLI compatibility tests
```

Each frozen directory is installed as a whole after writing and validating its
encrypted content and manifest. A version cannot be replaced. A public manifest
contains only its fixed schema, age format, opaque dataset ID, version, versioned
key reference/public recipient, and ciphertext SHA-256. It has no case IDs,
headwords, reasons, provenance, private content identity, or per-case digests.

The encrypted body includes the dataset ID, version, full membership, complete
case input/expectations/provenance/approval/splits, and a whole-dataset content
identity. `loadFrozenDataset` requires the selected manifest, checks that selection
and the ciphertext digest, decrypts with the referenced key, and checks the embedded
record identity, complete content identity, approval, and split invariants. Future
evaluation code can use this operation directly. It must keep expectations with
the scorer and send only the exact headword and fixed policy question to the model.

## Checkable harmless trace

The Chromium acceptance test uses `exuberant`, the approved harmless walkthrough
word. Its test finding is a synthetic form entry, not an approved golden label.

1. `page.ts` renders an empty finding selector, with the firm-label box ticked
   by default. The test enters `exuberant`, chooses a stand-in `clear` finding,
   and enters `harmless-browser-reason-marker` with an HTML-looking suffix and
   `harmless-browser-source-marker` as provenance. The suffix remains text and
   triggers no resource request.
2. `server.ts` receives the native POST with the session cookie, CSRF token, Origin,
   and workspace revision. `store.ts` creates an opaque case UUID, preserves the
   exact submitted values, records the content-bound approval because the label is
   firm, and saves `workspace.age` with the storage identity. No split was chosen.
3. Freezing now refuses: the page names one firm case without a split. The test
   moves it to development with **Save split changes**. Coverage shows one clear
   development case.
4. The test stops the server and constructs a fresh store/session. Decryption
   restores the same case UUID, content, approval, and split. A separate acceptance
   test repeats saving/reopening across actual CLI process restarts with Keychain.
5. A second synthetic case, `harmless-browser-headword-marker`, gets a stand-in
   blocked finding and **Held-out** on the entry form. One save stores, approves
   and assigns it. Freezing version 1 writes `appropriateness-v000001/cases.age`
   and its safe manifest under the test checkout. The loader verifies two cases.
6. Editing the first reason keeps its selected development split and records a new
   approval of the changed content, so version 2 freezes directly. Version 1's
   bytes and identity remain unchanged. Tests remove their temporary artifacts.
7. A simulated write failure preserves the old encrypted workspace and leaves the
   unsaved form visible with `Not confirmed saved. save_failed`. It does not claim
   saving succeeded. A key failure returns `key_unavailable` without private case
   text. A killed writer after ciphertext fsync leaves the previous workspace
   readable and blocks writes until explicit stopped-owner recovery.
8. A batch test moves two cases with one **Save split changes**, and a batch that
   splits connected spelling variants is refused whole, keeping the selections.

The browser trace exposed a native-form detail: `Referrer-Policy: no-referrer`
makes Chromium send `Origin: null` on POST. The implemented `same-origin` policy
keeps external referrers empty while preserving the required exact Origin check.
Variant tests also cover indirect cross-split connections through unassigned cases.

## Failures, conflicts, and restart

Two tabs or processes cannot silently overwrite each other. Every workspace write
requires the revision shown in its form and a shared exclusive file lock. A stale
form gets `revision_conflict`; reopen current saved state before retrying. A busy
writer or freezer gets `storage_busy`. A duplicate frozen version gets
`version_exists`. These responses contain codes, not raw exception details.

A successful save is durable. If a process dies before replacement, the prior
workspace remains intact. Temporary files contain only ciphertext or safe metadata.
They are ignored on restart. A crash can retain a lock containing only its schema,
PID, and opaque owner token. Recovery is explicit:

```sh
# First stop old authoring processes. Use the same private directory as start.
npm run eval:author -- recover
npm run eval:author -- start
```

Recovery checks that each recorded owner PID no longer exists before removing its
lock. Acquisition, release, and recovery share an exclusive short-lived `.guard`
file. Concurrent recovery cannot delete a new writer's lock. A live or reused PID
blocks recovery. An empty or malformed lock also blocks it. If a process dies
inside the short guard operation, the guard deliberately blocks access. Stop all
authoring/recovery processes before manually removing that guard file. Recovery
neither deletes datasets nor promotes temporary ciphertext to a saved
draft. Orphan ciphertext can remain until the owner removes it. There is no
automatic time-based takeover, key rotation, off-machine backup, or retention job.

After freezing, new cases, edits, label corrections, or split changes require a new
version. Later comparison must rerun the incumbent on that version before comparing
models. Frozen cases stay on the direct evaluation path and never enter lesson
generation.

## Verification

```sh
npm run typecheck
npm run test:authoring

# Include real macOS Keychain and CLI process-restart acceptance after setup.
WORDWELL_TEST_KEYCHAIN=1 npm run test:authoring

# If the pinned CLI is installed outside PATH, interoperability can select it.
WORDWELL_AGE_BINARY=/absolute/path/to/age npm run test:authoring
```

The browser tests require Playwright Chromium. Install it with
`npx playwright install chromium` if absent. The Keychain test is opt-in because
it provisions/reuses real local items. CLI interoperability skips when no CLI is
installed; completion evidence requires running it with the pinned binary present.

Verified originally with 17 authoring tests; the suite now has 22, adding one-step
saves, batch split moves, unassigning, and the freeze guard. Coverage includes both age
directions, wrong-key/corruption/truncation rejection, content/record selection,
missing-finding validation, reason-free approval/freezing, exploration-to-firm editing,
correction after approval, firm approvals, persistent
inspected-variant history, connected split checks,
save/freeze failures, a killed writer, recovery/acquisition interleaving,
concurrent conflicts, actual Chromium, marker scanning of files/public artifacts,
safe logs/errors, empty browser persistent storage, only loopback browser requests,
an authoring import graph without model/database/telemetry clients,
and actual Keychain-backed CLI process restart. No real private cases or model
requests were used. Setup leaves only the two dedicated Keychain identities and
safe local configuration. Harmless test workspaces and datasets are removed.
