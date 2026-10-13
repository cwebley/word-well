# Learner Sync API

The API is a small Node HTTP runtime backed by PostgreSQL. It owns the
authoritative learner profile, sessions, deliveries, passkeys, recovery-email
tokens, and learning-state acceptance rules. The learner cache and session grant
are separate client concerns; neither is stored by the API in a learner-safe
response.

## Local PostgreSQL

Start PostgreSQL and provision the separate local logins:

```sh
docker compose up -d postgres
npm run db:setup
```

Run the PostgreSQL HTTP seam tests with the same isolated database:

```sh
DATABASE_URL=postgresql://wordwell:wordwell@localhost:54329/wordwell_test npm run test:api
```

Run the API through `WORDWELL_LEARNER_DATABASE_URL` from `.env.database`,
with optional `PORT`:

```sh
npm run api
```

The HTTP tests use admin connections for fixtures and the real restricted
learner login for requests. See [local database setup](../local-database.md)
for connection selection, grants and repeat provisioning.

## Endpoints

- `POST /profiles/anonymous` creates an anonymous profile and returns one opaque
  session grant. An optional `X-Client-Context` header identifies that client
  context without becoming a learner credential.
- `GET /learning-state` returns the current learner-safe state and performs the
  current local-date delivery. The first successful online request assigns today
  and reserves up to five future candidates; a later date promotes the first
  reserved candidate without creating missed-date backlog.
- `POST /learning-state/sync` accepts `{ "operations": [] }` with at most 100
  familiarity, practice, active-use, utility, or content-quality operations.
- `POST /upcoming/:id/skip` skips one reserved upcoming word online and returns
  canonical state with a replacement when an eligible candidate exists.
- `POST /session/renew` revokes the presented grant and returns a rotated grant
  for the same client context.
- `GET /profile` returns the learner-safe profile (`state`, `canProtect`,
  passkeys, `recoveryEmail`).
- `POST /profile/history-accessed` records a `history-accessed` event so the
  profile can later become eligible for protection without waiting for the
  three-days threshold.
- `POST /profile/passkey-challenge` issues a single-use register or
  authenticate challenge bound to the active session. The client signs the
  challenge (the simulator just echoes it) and returns it on a subsequent
  protect, add-passkey, or authenticate call.
- `POST /profile/protect` promotes an anonymous profile to protected when the
  learner has meaningful history or a `history-accessed` event. It registers
  the first passkey and stamps the current session with
  `recently_authenticated_at`.
- `POST /profile/passkeys` registers an additional passkey. Requires the
  session to have been authenticated within the last five minutes.
- `DELETE /profile/passkeys/:id` revokes a passkey. Requires recent
  authentication and refuses to remove the last remaining passkey.
- `POST /profile/authenticate` consumes an authenticate challenge and refreshes
  the session's `recently_authenticated_at` to open the five-minute window.
- `POST /profile/recovery-email/request` issues a verification token for an
  email address (15-minute lifetime). Requires recent authentication.
- `POST /profile/recovery-email/verify` consumes the token and stores the
  verified email on the profile. The token is the credential; bearer grant is
  not required.
- `POST /profile/recover/start` issues a recovery token when the supplied email
  matches a protected profile (15-minute lifetime). Bearer grant is not
  required.
- `POST /profile/recover/complete` consumes the recovery token, registers a new
  passkey, revokes every prior session, and returns a fresh grant for the same
  profile id.
- `POST /profile/delete` tombstones the profile in one transaction. It populates
  `profiles.purge_schedule` with the live-data, backup, security, and IP-log
  retention windows and revokes every session, challenge, and recovery token.
- `POST /product-signals` accepts only consented, coarse installation events:
  `install_cta_shown`, `install_cta_started`, and `install_confirmed`, with an
  allowed capability and UTC day. It has no profile or device identifier.

Requests may include `X-Time-Zone` with the active client's IANA time zone. The
server stores it on that client context and uses it to calculate the local
calendar date. Lesson content returned to learners excludes pipeline and source
provenance fields; upcoming state contains only lightweight previews. Profile
responses only expose passkey id and label, never the public key or stored
challenge material.

Session grants are sent as `Authorization: Bearer <grant>`. A missing, expired,
or revoked grant returns `401` with `{"status":"session-expired"}`. A deleted
profile returns `410` with `{"status":"deleted"}`; deletion takes precedence
over session expiry. Profile mutations that require recent authentication return
`{"status":"authentication-required"}` so the client can re-authenticate
without losing the session.

## Versioned lesson consumer contract

`src/lesson-contract.ts` and `src/components/published-lesson.js` define and render
the public record. The API projects it before responding; the browser validates
and allowlists it again before caching. `src/fixtures/versioned-word-lesson.js`
is a synthetic consumer fixture used in restricted-credential API and browser
tests. It does not establish source acquisition or publication approval.

```text
published_lessons at stable lesson ID
    -> API projection -> versioned public lesson and separate practiceItems
    -> IndexedDB -> Today or earlier history -> renderPublishedLesson
```

`schemaVersion` is `wordwell-lesson-v1`. `lessonId` and each meaning's `id` are
stable identities; `publicationVersion` is a positive integer. The public record
contains headword, normalized headword, sourced pronunciation with its dialect,
optional sourced etymology, selected word family, definitions/POS, three examples,
coaching, nullable-sided synonym contrasts, common patterns and source-linked
usage/origin notes. Required Sources data contains release, license, credits,
notices and change indications. Wiktionary citations also require revision and
contributor-history links. The assembled lesson license is CC BY-SA 4.0; each
upstream source retains its own license and notices.

Each object in the schema declares its public fields. Projection strips undeclared
fields recursively, including nested generation provenance and prototype Practice.
Unknown schema versions, missing required fields, duplicate meaning/citation IDs,
unresolved public citation references and unsafe link protocols fail validation.
Absent source etymology requires null origin notes.
Source citation IDs refer to public attribution entries, not private source-record
or prompt-reference mappings. Links use HTTPS. The renderer escapes all field text
and attributes and omits absent optional sections while preserving Sources.

For the synthetic `lesson-candid` trace, `projectPublishedLesson` preserves meaning
`meaning-candid-direct`, sourced General American pronunciation and the two public
citations. A usage note references `dictionary-fixture`, which resolves to its
Sources entry in the rendered page. Added private fields at the record, meaning,
note, contrast, pronunciation or license boundary disappear from the projection.
Projection returns a new value; it does not alter the original record. These
checks establish shape and display behavior. Publication still owns source-backed
assembly, semantic approval, pronunciation confirmation and attribution accuracy.

The fixture deliberately includes a two-null contrast and a one-null contrast,
plus both a source etymology and a generated origin note. It exposes the fields
the prototype reader did not display. The renderer contains no Practice-answer
controls. An empty Practice bank shows an explicit no-items state, with no answer
controls or recall evidence.

## Independent Practice records

`published_practice_items` stores immutable revisions keyed by `item_id` and
`publication_version`, separately from lesson JSON. `wordwell-practice-v1` carries
`itemId`, `publicationVersion`, `lessonId`, `meaningId`, the bound `definition` and
`partOfSpeech`, `prompt`, `correctSentence`, `incorrectSentence` and `explanation`.
`src/practice-contract.ts` is the browser-safe public allowlist. No generator is
included. The learner login has SELECT permission, without content-write access.

The API's `practiceItems` array includes only available items for delivered,
available lessons whose current meaning ID, definition and POS match. Reordering
meanings or editing examples does not discard an item. A database trigger retires
items after definition/POS changes or meaning removal, including split/merge
identities. Restoring an old definition does not revive retired items. Withdrawn
lessons expose neither their record nor their bank.

Practice attempts include `practiceItemId` and `practiceVersion`. The API rejects
unknown versions and items belonging to another delivery's lesson. Retained
versions allow an already-served offline attempt to synchronize after withdrawal;
the attempt records the version served, while current state removes that item.
Retrying the same operation remains idempotent. Merely opening Practice with an
empty bank records nothing and leaves recall unchanged.

## History and fresh offline baseline

History opens the current public record by stable lesson ID, using the selected
delivery for familiarity and feedback. Replacement preserves delivery identity
and date. Withdrawal leaves an unavailable history row without an opening
control. An offline client reads its last downloaded version until a successful
sync replaces or removes it.

IndexedDB `wordwell` version 2 recreates the `learner-state` store on upgrade.
This deliberately discards disposable prototype content and its outbox. Saved
records also carry `wordwell-cache-v2`; the client ignores older cache/outbox
records without conversion. Sessions remain separate. The cache contains up to
50 recent delivered lessons and 500 matching Practice items, including complete
public Sources and license data. Recall scheduling lives in history, not in the
Practice-item bank.

Tests start with clean public fixture tables in `wordwell_test` or a disposable
acceptance database. They preserve the retained development database and private
evaluations. To reset disposable development content before loading new fixtures,
delete its associated learner deliveries/evidence and upcoming reservations in a
transaction, then delete `published_practice_items` and `published_lessons`.
Do not truncate the `private` schema or recreate the database. There is no
prototype content backfill or legacy reader. Migrations add storage and grants;
they do not delete development content themselves.

The obsolete `src/content-pipeline.ts` in-memory publisher and its register,
nested Practice and evaluation-coverage assumptions are removed. Stage execution
and evaluations live in `pipeline/` and `evals/`. Durable authorized lesson
assembly/publication remains the separate #29 implementation.
