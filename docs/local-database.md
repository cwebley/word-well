# Local database logins

```text
db:setup -> existing named PostgreSQL volume
             | wordwell_dev   durable development and encrypted evaluations
             | wordwell_test  destructive learner fixtures
             | unique test/restore databases, removed after each check

wordwell admin login         -> migrations, database creation and restore
wordwell_learner_login       -> wordwell_learner grants -> learner API
wordwell_pipeline_login      -> wordwell_pipeline grants -> private runner/report
```

## Setup and repeat provisioning

```sh
docker compose up -d --wait
npm run db:setup
npm run api
```

`db/setup-local.mjs` connects to the existing local cluster. It creates
`wordwell_dev` and `wordwell_test` only if missing, then applies outstanding
migrations in both. It never drops a database or recreates the
`wordwell-postgres` volume.

On first setup, it writes `.env.database` with mode `0600`. Git ignores this
file. It contains the admin URL and randomly generated, distinct learner and
pipeline passwords. The default admin login is the existing Compose bootstrap
login. Set `WORDWELL_ADMIN_DATABASE_URL` before first setup to select another
local bootstrap connection. Setup requires the development database name
`wordwell_dev` and a loopback host.

Repeat `npm run db:setup` after container recreation or checkout updates. It
reuses the saved passwords, repairs runtime login attributes and membership,
and applies new migrations. It preserves database rows, existing ciphertext,
frozen dataset artifacts, Keychain identities and accounting files. Setup failure
prints `local_database_setup_failed`. Fix the local connection or server and
repeat setup using the same file.

## Connection selection

`db/connections.mjs` loads `.env.database`. Existing shell variables take
precedence. The runtime commands choose one specific connection:

| Command | Connection variable | Local database |
| --- | --- | --- |
| `npm run db:migrate` | `WORDWELL_ADMIN_DATABASE_URL` | `wordwell_dev` |
| `npm run api` | `WORDWELL_LEARNER_DATABASE_URL` | `wordwell_dev` |
| `eval:private`, `eval:private:report` | `WORDWELL_PIPELINE_DATABASE_URL` | `wordwell_dev` |
| `eval:private:restore-check` | Admin for dump/restore; learner and pipeline for restored reads | Unique throwaway database |

Migrations also accept an explicit `DATABASE_URL` for test/restore setup. The
API and private runner do not use that generic variable. Their URLs must name
their restricted login. `WORDWELL_PRIVATE_DATABASE_URL` is superseded by
`WORDWELL_PIPELINE_DATABASE_URL`.

## Permissions and new migrations

The admin login owns migrated tables. The runtime logins are nonsuperusers with
no database creation, role creation, replication, bypass-RLS or admin membership.
They inherit only their corresponding `NOLOGIN` grant role. Neither runtime job
can create schemas, public/private tables or temporary tables.

`db/private-migrations/003_job_permissions.sql` grants the learner read access to
`published_lessons`, read/write access to the named learner tables, and access to
the learner-operation counter. `004_learner_counters.sql` grants the serial
counters for profile-access events and product signals. The learner cannot
insert, update, delete, truncate or alter lessons. It cannot use the private
schema, read its tables or read migration history.

The pipeline can select, insert and update private evaluation records. It cannot
delete them, change their schema, access learner records or publish lessons.
Later publication work must extend permissions through its own migration.

New private tables created by the same migration owner inherit pipeline
select/insert/update grants. New public tables receive no runtime grants. Their
migration must name the required job and operations explicitly. New sequences
also need explicit grants. Use the same admin owner for later migrations so
these default privileges apply.

## Checks and database separation

```sh
npm run test:db-logins
DATABASE_URL=postgresql://wordwell:wordwell@127.0.0.1:54329/wordwell_test npm run test:api
DATABASE_URL=postgresql://wordwell:wordwell@127.0.0.1:54329/wordwell_test npm run test:private
DATABASE_URL=postgresql://wordwell:wordwell@127.0.0.1:54329/wordwell_test npm run test:acceptance
npm run typecheck
```

The login suite and private suites create unique disposable databases with the
admin connection. Actual storage work uses the pipeline login. The HTTP suite
uses admin fixtures in `wordwell_test` and a separate learner-login pool for
requests. It rejects a development database fixture URL. Browser acceptance
creates a disposable database and also serves through the learner login.
CI provisions the same roles before these checks. Role-switching privacy tests
remain additional checks.

The logins are cluster-wide and can connect to both local databases. Database
separation prevents test fixture replacement of development records; it does
not give development and tests different passwords. Never point destructive
fixtures at `wordwell_dev`.

## Checkable request trace

`db/logins.test.ts` inserts the harmless published fixture `lesson-candid` through
the admin connection in a disposable database. Its headword is `candid`, and its
record has one harmless test meaning. This is a permission fixture, not a real
source-backed publication.

1. The test starts `api/server.ts` with that database's learner URL.
2. `POST /profiles/anonymous` returns HTTP 201 and an opaque session grant.
   `api/database.ts` persists the profile and session through the learner pool.
3. `GET /learning-state` with that grant returns HTTP 200 and a `candid`
   delivery. The API reads `published_lessons` and writes a delivery, but does
   not update the lesson.
4. `POST /profile/history-accessed` returns HTTP 200. `POST /product-signals`
   returns HTTP 204. Both persist through counters granted to the learner job.
5. The learner connection receives PostgreSQL `42501` for private-table reads
   and every tested lesson mutation. The pipeline connection can read private
   tables but receives `42501` for schema changes and privileged role acquisition.
6. The child API stops and the test database is removed. A denied statement
   changes no lesson or private record. Repeating the suite creates a new fixture.

The trace exposed two serial counters that the old read-only learner role never
used. Table grants alone did not authorize profile-access or product-signal
inserts, so those sequences now have explicit learner grants.

The encrypted restore check needs existing Keychain identities and external
frozen artifacts. It reads saved evaluations with the pipeline login, blocks
network fetches and compares source rows before and after. See
[private-results-and-restore.md](private-results-and-restore.md).
