# Learner Sync API

The API is a small Node HTTP runtime backed by PostgreSQL. It owns the
authoritative learner profile, sessions, deliveries, and learning-state
acceptance rules. The learner cache and session grant are separate client
concerns; neither is stored by the API in a learner-safe response.

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

Requests may include `X-Time-Zone` with the active client's IANA time zone. The
server stores it on that client context and uses it to calculate the local
calendar date. Lesson content returned to learners excludes pipeline and source
provenance fields; upcoming state contains only lightweight previews.

Session grants are sent as `Authorization: Bearer <grant>`. A missing, expired,
or revoked grant returns `401` with `{"status":"session-expired"}`. A deleted
profile returns `410` with `{"status":"deleted"}`; deletion takes precedence
over session expiry.
