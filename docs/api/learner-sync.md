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
- `GET /learning-state` returns the current learner-safe state.
- `POST /learning-state/sync` accepts `{ "operations": [] }` with at most 100
  familiarity, practice, active-use, utility, or content-quality operations.
- `POST /session/renew` revokes the presented grant and returns a rotated grant
  for the same client context.

Session grants are sent as `Authorization: Bearer <grant>`. A missing, expired,
or revoked grant returns `401` with `{"status":"session-expired"}`. A deleted
profile returns `410` with `{"status":"deleted"}`; deletion takes precedence
over session expiry.
