import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
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

  async createAnonymousProfile(clientContextId?: string): Promise<{ profile: { state: "anonymous" }; session: Session }> {
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
      await insertSession(client, profileId, session, now, clientContextId);
      await client.query("COMMIT");
      return { profile: { state: "anonymous" }, session: publicSession(session) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async readState(grant: string): Promise<RepositoryResponse> {
    return this.#withAuthorizedSession(grant, async (client, profileId) => {
      return { status: "active", state: await learnerState(client, profileId) };
    });
  }

  async synchronize(grant: string, operations: readonly SyncOperation[]): Promise<RepositoryResponse> {
    if (operations.length > maxSyncOperations) {
      throw new ApiError(400, `A sync batch cannot contain more than ${maxSyncOperations} operations.`);
    }

    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const authorization = await authorize(client, grant, this.#now());
      if (authorization.status !== "active") {
        await client.query("ROLLBACK");
        return authorization;
      }

      for (const operation of operations) {
        await acceptOperation(client, authorization.profileId, authorization.clientContextId, operation, this.#now());
      }

      const state = await learnerState(client, authorization.profileId);
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
      await insertSession(client, authorization.profileId, session, this.#now(), authorization.clientContextId);
      await client.query("COMMIT");
      return { status: "active", session: publicSession(session) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async #withAuthorizedSession<T>(grant: string, action: (client: PoolClient, profileId: string) => Promise<T>): Promise<T | RepositoryResponse> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const authorization = await authorize(client, grant, this.#now());
      if (authorization.status !== "active") {
        await client.query("ROLLBACK");
        return authorization;
      }
      const result = await action(client, authorization.profileId);
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

async function authorize(client: Queryable, grant: string, now: Date, renewContact = true): Promise<{ status: "active"; profileId: string; clientContextId: string } | { status: "deleted" } | { status: "session-expired" }> {
  const result = await client.query<{
    profile_id: string;
    client_context_id: string;
    profile_state: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT s.profile_id, s.client_context_id, s.expires_at, s.revoked_at, p.state AS profile_state
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
  if (renewContact) {
    await client.query(
      "UPDATE sessions SET last_contact_at = $2, expires_at = $3 WHERE grant_digest = $1",
      [digest(grant), now, new Date(now.getTime() + sessionLifetimeMs)]
    );
  }
  return { status: "active", profileId: session.profile_id, clientContextId: session.client_context_id };
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

async function learnerState(client: Queryable, profileId: string): Promise<LearnerState> {
  const [lessons, deliveries, evidence, mutable] = await Promise.all([
    client.query<{ id: string; record: Record<string, unknown> }>(
      `SELECT id, record FROM published_lessons
        WHERE available AND id IN (SELECT lesson_id FROM deliveries WHERE profile_id = $1)
        ORDER BY id`,
      [profileId]
    ),
    client.query<{
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
    ),
    client.query<Record<string, unknown>>(
      `SELECT operation_id AS id, kind, delivery_id AS "deliveryId", details,
              accepted_at::text AS "acceptedAt", accepted_order AS "order"
         FROM learner_evidence WHERE profile_id = $1 ORDER BY accepted_order`,
      [profileId]
    ),
    client.query<Record<string, unknown>>(
      `SELECT operation_id AS id, kind, delivery_id AS "deliveryId", details,
              accepted_at::text AS "acceptedAt", accepted_order AS "order"
         FROM learner_choices WHERE profile_id = $1 ORDER BY accepted_order`,
      [profileId]
    )
  ]);

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

  return { lessons: safeLessons, history, evidence: evidenceRows, mutable: mutableRows };
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

async function insertSession(client: Queryable, profileId: string, session: { id: string; grant: string; expiresAt: Date }, now: Date, clientContextId: string | undefined = randomUUID()): Promise<void> {
  await client.query(
    `INSERT INTO sessions (id, profile_id, client_context_id, grant_digest, created_at, last_contact_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6)`,
    [session.id, profileId, clientContextId, digest(session.grant), now, new Date(now.getTime() + sessionLifetimeMs)]
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
