# Learner Sync API

The API is a small Node HTTP runtime backed by PostgreSQL. It owns the
authoritative learner profile, sessions, deliveries, passkeys, recovery-email
tokens, and learning-state acceptance rules. The learner cache and session grant
are separate client concerns; neither is stored by the API in a learner-safe
response.

## Local PostgreSQL

Start the fixture with Docker Compose, then apply SQL migrations:

```sh
docker compose up -d postgres
DATABASE_URL=postgresql://wordwell:wordwell@localhost:54329/wordwell_test npm run db:migrate
```

Run the PostgreSQL HTTP seam tests with the same isolated database:

```sh
DATABASE_URL=postgresql://wordwell:wordwell@localhost:54329/wordwell_test npm run test:api
```

Run the API after migrations with `DATABASE_URL` and optionally `PORT`:

```sh
DATABASE_URL=postgresql://wordwell:wordwell@localhost:54329/wordwell_test npm run api
```

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
