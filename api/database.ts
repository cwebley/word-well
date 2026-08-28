import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  maxSyncOperations,
  permittedKinds,
  sessionLifetimeMs,
  type LearnerState,
  type RepositoryResponse,
  type Session,
  type SyncOperation
} from "./types.js";

type Queryable = Pick<PoolClient, "query">;
type Clock = () => Date;
type ActiveAuthorization = { status: "active"; profileId: string; clientContextId: string; timeZone: string };

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class LearnerDatabase {
  readonly #pool: Pool;
  readonly #now: Clock;

  constructor({ pool, now = () => new Date() }: { pool: Pool; now?: Clock }) {
    this.#pool = pool;
    this.#now = now;
  }

  async createAnonymousProfile(clientContextId?: string, timeZone = "UTC"): Promise<{ profile: { state: "anonymous" }; session: Session }> {
    validateTimeZone(timeZone);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const profileId = randomUUID();
      const now = this.#now();
      const session = makeSession(now);
      await client.query(
        "INSERT INTO profiles (id, state, created_at) VALUES ($1, 'anonymous', $2)",
        [profileId, now]
      );
      await insertSession(client, profileId, session, now, clientContextId, timeZone);
      await client.query("COMMIT");
      return { profile: { state: "anonymous" }, session: publicSession(session) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async readState(grant: string, timeZone?: string): Promise<RepositoryResponse> {
    if (timeZone) validateTimeZone(timeZone);
    return this.#withAuthorizedSession(grant, timeZone, async (client, authorization) => {
      const now = this.#now();
      await ensureDailyDelivery(client, authorization.profileId, authorization.timeZone, now);
      return { status: "active", state: await learnerState(client, authorization.profileId, dateInTimeZone(now, authorization.timeZone)) };
    });
  }

  async synchronize(grant: string, operations: readonly SyncOperation[], timeZone?: string): Promise<RepositoryResponse> {
    if (timeZone) validateTimeZone(timeZone);
    if (operations.length > maxSyncOperations) {
      throw new ApiError(400, `A sync batch cannot contain more than ${maxSyncOperations} operations.`);
    }

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const authorization = await authorize(client, grant, this.#now(), true, timeZone);
      if (authorization.status !== "active") {
        await client.query("ROLLBACK");
        return authorization;
      }

      const now = this.#now();
      await ensureDailyDelivery(client, authorization.profileId, authorization.timeZone, now);
      for (const operation of operations) {
        await acceptOperation(client, authorization.profileId, authorization.clientContextId, operation, this.#now());
      }

      const state = await learnerState(client, authorization.profileId, dateInTimeZone(now, authorization.timeZone));
      await client.query("COMMIT");
      return { status: "active", state };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async renewSession(grant: string): Promise<{ status: "active"; session: Session } | { status: "deleted" } | { status: "session-expired" }> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const authorization = await authorize(client, grant, this.#now(), false);
      if (authorization.status !== "active") {
        await client.query("ROLLBACK");
        return authorization;
      }
      await client.query("UPDATE sessions SET revoked_at = $2 WHERE grant_digest = $1", [digest(grant), this.#now()]);
      const session = makeSession(this.#now());
      await insertSession(client, authorization.profileId, session, this.#now(), authorization.clientContextId, authorization.timeZone);
      await client.query("COMMIT");
      return { status: "active", session: publicSession(session) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async skipUpcoming(grant: string, upcomingId: string, timeZone?: string): Promise<RepositoryResponse> {
    if (timeZone) validateTimeZone(timeZone);
    return this.#withAuthorizedSession(grant, timeZone, async (client, authorization) => {
      const now = this.#now();
      await ensureDailyDelivery(client, authorization.profileId, authorization.timeZone, now);
      const upcoming = await client.query<{ normalized_headword: string }>(
        "SELECT normalized_headword FROM reserved_upcoming_words WHERE id = $1 AND profile_id = $2",
        [upcomingId, authorization.profileId]
      );
      if (!upcoming.rowCount) {
        const alreadySkipped = await client.query(
          "SELECT 1 FROM skipped_upcoming_words WHERE profile_id = $1 AND upcoming_id = $2",
          [authorization.profileId, upcomingId]
        );
        if (alreadySkipped.rowCount) {
          return {
            status: "active",
            state: await learnerState(client, authorization.profileId, dateInTimeZone(now, authorization.timeZone))
          };
        }
        throw new ApiError(404, "The upcoming word was not found.");
      }
      await client.query(
        `INSERT INTO skipped_upcoming_words (profile_id, normalized_headword, upcoming_id, skipped_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [authorization.profileId, upcoming.rows[0]!.normalized_headword, upcomingId, now]
      );
      await client.query("DELETE FROM reserved_upcoming_words WHERE id = $1", [upcomingId]);
      await fillUpcoming(client, authorization.profileId, now);
      return {
        status: "active",
        state: await learnerState(client, authorization.profileId, dateInTimeZone(now, authorization.timeZone))
      };
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #withAuthorizedSession<T>(grant: string, timeZone: string | undefined, action: (client: PoolClient, authorization: ActiveAuthorization) => Promise<T>): Promise<T | RepositoryResponse> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      if (timeZone) validateTimeZone(timeZone);
      const authorization = await authorize(client, grant, this.#now(), true, timeZone);
      if (authorization.status !== "active") {
        await client.query("ROLLBACK");
        return authorization;
      }
      const result = await action(client, authorization);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

async function authorize(client: Queryable, grant: string, now: Date, renewContact = true, requestedTimeZone?: string): Promise<ActiveAuthorization | { status: "deleted" } | { status: "session-expired" }> {
  const result = await client.query<{
    profile_id: string;
    client_context_id: string;
    profile_state: string;
    time_zone: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT s.profile_id, s.client_context_id, s.time_zone, s.expires_at, s.revoked_at, p.state AS profile_state
      FROM sessions s
       JOIN profiles p ON p.id = s.profile_id
      WHERE s.grant_digest = $1
      FOR UPDATE OF s, p`,
    [digest(grant)]
  );
  const session = result.rows[0];
  if (!session) return { status: "session-expired" };
  if (session.profile_state === "tombstoned") return { status: "deleted" };
  if (session.revoked_at || session.expires_at <= now) return { status: "session-expired" };
  const timeZone = requestedTimeZone ?? session.time_zone;
  if (renewContact) {
    await client.query(
      "UPDATE sessions SET last_contact_at = $2, expires_at = $3, time_zone = $4 WHERE grant_digest = $1",
      [digest(grant), now, new Date(now.getTime() + sessionLifetimeMs), timeZone]
    );
  }
  return { status: "active", profileId: session.profile_id, clientContextId: session.client_context_id, timeZone };
}

async function acceptOperation(client: Queryable, profileId: string, clientContextId: string, operation: SyncOperation, now: Date): Promise<void> {
  const operationHash = hashOperation(operation);
  const existing = await client.query<{ operation_hash: string }>(
    "SELECT operation_hash FROM accepted_operations WHERE profile_id = $1 AND operation_id = $2",
    [profileId, operation.id]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].operation_hash !== operationHash) throw new ApiError(409, "An operation ID was reused with different data.");
    return;
  }

  const delivery = await client.query("SELECT id FROM deliveries WHERE profile_id = $1 AND id = $2", [profileId, operation.deliveryId]);
  if (!delivery.rowCount) throw new ApiError(400, "The operation references no delivery for this profile.");

  const details = detailsFor(operation);
  const accepted = await client.query<{ accepted_order: string }>(
    `INSERT INTO accepted_operations
      (profile_id, operation_id, client_context_id, operation_hash, kind, delivery_id, details, accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING accepted_order`,
    [profileId, operation.id, clientContextId, operationHash, operation.kind, operation.deliveryId, details, now]
  );
  const order = accepted.rows[0]!.accepted_order;

  if (operation.kind === "practice" || operation.kind === "utility" || operation.kind === "content-quality") {
    await client.query(
      `INSERT INTO learner_evidence
        (profile_id, operation_id, delivery_id, kind, details, accepted_at, accepted_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [profileId, operation.id, operation.deliveryId, operation.kind, details, now, order]
    );
  } else {
    await client.query(
      `INSERT INTO learner_choices
        (profile_id, delivery_id, kind, operation_id, details, accepted_at, accepted_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (profile_id, delivery_id, kind) DO UPDATE
         SET operation_id = EXCLUDED.operation_id,
             details = EXCLUDED.details,
             accepted_at = EXCLUDED.accepted_at,
             accepted_order = EXCLUDED.accepted_order
       WHERE learner_choices.accepted_order < EXCLUDED.accepted_order`,
      [profileId, operation.deliveryId, operation.kind, operation.id, details, now, order]
    );
  }
}

async function ensureDailyDelivery(client: Queryable, profileId: string, timeZone: string, now: Date): Promise<void> {
  const localDate = dateInTimeZone(now, timeZone);
  await discardIneligibleUpcoming(client, profileId);
  const existing = await client.query("SELECT 1 FROM deliveries WHERE profile_id = $1 AND local_date = $2", [profileId, localDate]);
  if (existing.rowCount) {
    await fillUpcoming(client, profileId, now);
    return;
  }

  const reserved = await nextReserved(client, profileId);
  const selected = reserved.rows[0] ?? (await nextLesson(client, profileId)).rows[0];
  if (selected) {
    await client.query(
      `INSERT INTO deliveries (id, profile_id, local_date, lesson_id, normalized_headword)
       VALUES ($1, $2, $3, $4, $5)`,
      [`${profileId}:${localDate}`, profileId, localDate, selected.lesson_id, selected.normalized_headword]
    );
    if (reserved.rows[0]) await client.query("DELETE FROM reserved_upcoming_words WHERE id = $1", [reserved.rows[0].id]);
  }
  await fillUpcoming(client, profileId, now);
}

type ReservedSelection = {
  id: string;
  lesson_id: string;
  normalized_headword: string;
};

async function nextReserved(client: Queryable, profileId: string): Promise<QueryResult<ReservedSelection>> {
  return client.query<ReservedSelection>(
    `SELECT r.id, r.lesson_id, r.normalized_headword
       FROM reserved_upcoming_words r
      WHERE r.profile_id = $1
      ORDER BY r.queue_position
      LIMIT 1`,
    [profileId]
  );
}

async function discardIneligibleUpcoming(client: Queryable, profileId: string): Promise<void> {
  const invalid = await client.query<{ id: string }>(
    `SELECT r.id
       FROM reserved_upcoming_words r
       JOIN published_lessons l ON l.id = r.lesson_id
       JOIN profiles p ON p.id = r.profile_id
      WHERE r.profile_id = $1
        AND (
          NOT l.available
          OR jsonb_typeof(l.record->'meanings') <> 'array'
          OR jsonb_array_length(l.record->'meanings') = 0
          OR COALESCE(NULLIF(l.record->>'startingBand', ''), l.starting_band) <> p.starting_band
          OR EXISTS (SELECT 1 FROM deliveries d WHERE d.profile_id = $1 AND d.normalized_headword = r.normalized_headword)
          OR EXISTS (SELECT 1 FROM skipped_upcoming_words s WHERE s.profile_id = $1 AND s.normalized_headword = r.normalized_headword)
        )`,
    [profileId]
  );
  for (const row of invalid.rows) await client.query("DELETE FROM reserved_upcoming_words WHERE id = $1", [row.id]);
}

async function nextLesson(client: Queryable, profileId: string): Promise<QueryResult<{ id: string; lesson_id: string; normalized_headword: string }>> {
  return client.query<{ id: string; lesson_id: string; normalized_headword: string }>(
    `SELECT NULL::uuid AS id, l.id AS lesson_id, l.normalized_headword
       FROM published_lessons l
       JOIN profiles p ON p.id = $1
        WHERE l.available
        AND jsonb_typeof(l.record->'meanings') = 'array'
        AND jsonb_array_length(l.record->'meanings') > 0
        AND COALESCE(NULLIF(l.record->>'startingBand', ''), l.starting_band) = p.starting_band
        AND NOT EXISTS (
          SELECT 1 FROM deliveries d
           WHERE d.profile_id = $1 AND d.normalized_headword = l.normalized_headword
        )
        AND NOT EXISTS (
          SELECT 1 FROM skipped_upcoming_words s
           WHERE s.profile_id = $1 AND s.normalized_headword = l.normalized_headword
        )
      ORDER BY l.id
      LIMIT 1`,
    [profileId]
  );
}

async function fillUpcoming(client: Queryable, profileId: string, now: Date): Promise<void> {
  const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM reserved_upcoming_words WHERE profile_id = $1", [profileId]);
  const vacancies = Math.max(0, 5 - Number(count.rows[0]?.count ?? 0));
  for (let index = 0; index < vacancies; index += 1) {
    const candidate = await client.query<{ id: string; normalized_headword: string }>(
      `SELECT l.id, l.normalized_headword
         FROM published_lessons l
         JOIN profiles p ON p.id = $1
        WHERE l.available
          AND jsonb_typeof(l.record->'meanings') = 'array'
          AND jsonb_array_length(l.record->'meanings') > 0
          AND COALESCE(NULLIF(l.record->>'startingBand', ''), l.starting_band) = p.starting_band
          AND NOT EXISTS (
            SELECT 1 FROM deliveries d
             WHERE d.profile_id = $1 AND d.normalized_headword = l.normalized_headword
          )
          AND NOT EXISTS (
            SELECT 1 FROM skipped_upcoming_words s
             WHERE s.profile_id = $1 AND s.normalized_headword = l.normalized_headword
          )
          AND NOT EXISTS (
            SELECT 1 FROM reserved_upcoming_words r
             WHERE r.profile_id = $1 AND r.normalized_headword = l.normalized_headword
          )
        ORDER BY l.id
        LIMIT 1`,
      [profileId]
    );
    if (!candidate.rowCount) return;
    const position = await client.query<{ position: number }>(
      "SELECT COALESCE(max(queue_position), 0) + 1 AS position FROM reserved_upcoming_words WHERE profile_id = $1",
      [profileId]
    );
    await client.query(
      `INSERT INTO reserved_upcoming_words (id, profile_id, lesson_id, normalized_headword, queue_position, reserved_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), profileId, candidate.rows[0]!.id, candidate.rows[0]!.normalized_headword, position.rows[0]!.position, now]
    );
  }
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new ApiError(400, "The time zone must be a valid IANA time zone.");
  }
}

function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function learnerState(client: Queryable, profileId: string, localDate?: string): Promise<LearnerState> {
  const lessons = await client.query<{ id: string; record: Record<string, unknown> }>(
    `SELECT id, record FROM published_lessons
      WHERE available AND id IN (SELECT lesson_id FROM deliveries WHERE profile_id = $1)
      ORDER BY id`,
    [profileId]
  );
  const deliveries = await client.query<{
      id: string;
      lesson_id: string;
      local_date: string;
      normalized_headword: string;
      available: boolean;
      familiarity: string | null;
      active_use: string | null;
      familiarity_at: Date | null;
      active_use_at: Date | null;
    }>(
    `SELECT d.id, d.lesson_id, d.local_date::text, d.normalized_headword, l.available,
            familiarity.details->>'familiarity' AS familiarity,
            active_use.details->>'activeUse' AS active_use,
            familiarity.accepted_at AS familiarity_at,
            active_use.accepted_at AS active_use_at
       FROM deliveries d
       JOIN published_lessons l ON l.id = d.lesson_id
       LEFT JOIN learner_choices familiarity
         ON familiarity.profile_id = d.profile_id AND familiarity.delivery_id = d.id AND familiarity.kind = 'familiarity'
       LEFT JOIN learner_choices active_use
         ON active_use.profile_id = d.profile_id AND active_use.delivery_id = d.id AND active_use.kind = 'active-use'
      WHERE d.profile_id = $1
      ORDER BY d.local_date DESC`,
    [profileId]
  );
  const evidence = await client.query<Record<string, unknown>>(
    `SELECT operation_id AS id, kind, delivery_id AS "deliveryId", details,
            accepted_at::text AS "acceptedAt", accepted_order AS "order"
       FROM learner_evidence WHERE profile_id = $1 ORDER BY accepted_order`,
    [profileId]
  );
  const mutable = await client.query<Record<string, unknown>>(
    `SELECT operation_id AS id, kind, delivery_id AS "deliveryId", details,
            accepted_at::text AS "acceptedAt", accepted_order AS "order"
       FROM learner_choices WHERE profile_id = $1 ORDER BY accepted_order`,
    [profileId]
  );

  const safeLessons = lessons.rows.map((row) => ({ id: row.id, record: learnerSafe(row.record) }));
  const evidenceRows = evidence.rows.map(flattenStoredOperation);
  const mutableRows = mutable.rows.map(flattenStoredOperation);
  const history = deliveries.rows.map((delivery) => {
    const deliveryEvidence = evidenceRows.filter((event) => event.deliveryId === delivery.id);
    const familiarity = delivery.familiarity ?? undefined;
    const activeUse = delivery.active_use ?? undefined;
    return {
      id: delivery.id,
      lessonId: delivery.lesson_id,
      localDate: delivery.local_date,
      normalizedHeadword: delivery.normalized_headword,
      status: delivery.available ? "current" : "unavailable",
      ...(familiarity ? { familiarity } : {}),
      ...(delivery.familiarity_at ? { recall: rebuildRecall(familiarity, activeUse, deliveryEvidence, delivery.familiarity_at, delivery.active_use_at) } : {})
    };
  });

  const state: LearnerState = { lessons: safeLessons, history, evidence: evidenceRows, mutable: mutableRows };
  const activeDelivery = localDate ? history.find((delivery) => delivery.localDate === localDate) : undefined;

  const upcoming = await client.query<Record<string, unknown>>(
    `SELECT r.id, r.lesson_id AS "lessonId", r.normalized_headword AS "normalizedHeadword",
            l.record->>'headword' AS headword,
            COALESCE(NULLIF(l.record->>'startingBand', ''), l.starting_band) AS "startingBand"
       FROM reserved_upcoming_words r
       JOIN published_lessons l ON l.id = r.lesson_id
      WHERE r.profile_id = $1
      ORDER BY r.queue_position`,
    [profileId]
  );
  return {
    ...state,
    ...(activeDelivery ? { delivery: activeDelivery } : {}),
    ...(upcoming.rows.length ? { upcoming: upcoming.rows.map(learnerSafe) } : {})
  };
}

function rebuildRecall(familiarity: string | undefined, activeUse: string | undefined, evidence: readonly Record<string, unknown>[], familiarityAt: Date, activeUseAt: Date | null): Record<string, unknown> | undefined {
  if (!familiarity) return undefined;
  const stages = ["new", "1 day", "3 days", "7 days", "14 days", "30 days"];
  let mastery = { "I use it all the time": 3, "Familiar, but I don't use it": 2, "I think I've heard of it": 1, "Completely new to me": 0 }[familiarity] ?? 0;
  let stage = "new";
  let dueAt = familiarityAt.toISOString();
  for (const event of evidence.filter((item) => item.kind === "practice")) {
    const correct = event.correct === true;
    const index = stages.indexOf(stage);
    const next = correct ? Math.min(index + 1, stages.length - 1) : Math.max(index - 1, 0);
    stage = stages[next]!;
    mastery = Math.max(0, mastery + (correct ? 1 : -1));
    dueAt = addDays(String(event.acceptedAt), correct ? [0, 1, 3, 7, 14, 30][next]! : Math.max(1, [0, 1, 3, 7, 14, 30][next]!));
  }
  if (activeUse === "using") {
    const index = Math.min(stages.indexOf(stage) + 1, stages.length - 1);
    stage = stages[index]!;
    mastery += 1;
    dueAt = addDays((activeUseAt ?? familiarityAt).toISOString(), [0, 1, 3, 7, 14, 30][index]!);
  }
  return { stage, dueAt, mastery };
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function flattenStoredOperation(value: Record<string, unknown>): Record<string, unknown> {
  const details = value.details && typeof value.details === "object" ? value.details as Record<string, unknown> : {};
  const { details: _details, ...operation } = value;
  return learnerSafe({ ...details, ...operation });
}

function detailsFor(operation: SyncOperation): Record<string, unknown> {
  switch (operation.kind) {
    case "familiarity":
      return { familiarity: operation.familiarity };
    case "practice":
      return { correct: operation.correct };
    case "active-use":
      return { activeUse: operation.activeUse };
    case "utility":
      return { utility: operation.utility };
    case "content-quality":
      return {};
  }
}

function learnerSafe(value: unknown): any {
  if (Array.isArray(value)) return value.map(learnerSafe);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/session|passkey|credential|recovery|analytics|pipeline|provenance/i.test(key))
    .map(([key, item]) => [key, learnerSafe(item)]));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function hashOperation(operation: SyncOperation): string {
  return createHash("sha256").update(stableJson({
    id: operation.id,
    kind: operation.kind,
    deliveryId: operation.deliveryId,
    createdAt: operation.createdAt,
    ...detailsFor(operation)
  })).digest("hex");
}

function digest(grant: string): string {
  return createHash("sha256").update(grant).digest("hex");
}

function makeSession(now: Date): { id: string; grant: string; expiresAt: Date } {
  return { id: randomUUID(), grant: randomBytes(32).toString("base64url"), expiresAt: new Date(now.getTime() + sessionLifetimeMs) };
}

function publicSession(session: { grant: string; expiresAt: Date }): Session {
  return { grant: session.grant, expiresAt: session.expiresAt.toISOString() };
}

async function insertSession(client: Queryable, profileId: string, session: { id: string; grant: string; expiresAt: Date }, now: Date, clientContextId: string | undefined = randomUUID(), timeZone = "UTC"): Promise<void> {
  await client.query(
    `INSERT INTO sessions (id, profile_id, client_context_id, grant_digest, created_at, last_contact_at, expires_at, time_zone)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
    [session.id, profileId, clientContextId, digest(session.grant), now, new Date(now.getTime() + sessionLifetimeMs), timeZone]
  );
}

export function validateOperations(value: unknown): SyncOperation[] {
  if (!Array.isArray(value) || value.length > maxSyncOperations) throw new ApiError(400, "Sync operations must be a bounded array.");
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object") throw new ApiError(400, "Each sync operation must be an object.");
    const operation = candidate as Record<string, unknown>;
    if (typeof operation.id !== "string" || !operation.id || typeof operation.kind !== "string" || !permittedKinds.includes(operation.kind as never) || typeof operation.deliveryId !== "string" || !operation.deliveryId || typeof operation.createdAt !== "string" || Number.isNaN(Date.parse(operation.createdAt))) {
      throw new ApiError(400, "Each sync operation needs a valid id, kind, deliveryId, and createdAt.");
    }
    if (operation.kind === "familiarity" && !["Completely new to me", "I think I've heard of it", "Familiar, but I don't use it", "I use it all the time"].includes(String(operation.familiarity))) throw new ApiError(400, "Familiarity was not recognized.");
    if (operation.kind === "practice" && typeof operation.correct !== "boolean") throw new ApiError(400, "Practice correctness must be boolean.");
    if (operation.kind === "active-use" && !["using", "not_using"].includes(String(operation.activeUse))) throw new ApiError(400, "Active-use state was not recognized.");
    if (operation.kind === "utility" && !["useful", "not_useful"].includes(String(operation.utility))) throw new ApiError(400, "Utility state was not recognized.");
    return operation as unknown as SyncOperation;
  });
}
