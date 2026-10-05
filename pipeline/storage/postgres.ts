// Application-encrypted PostgreSQL storage for private pipeline records (#8).
// Callers pass and receive plain typed records; this module encrypts every
// payload with the storage key, binding each ciphertext to its table, row and
// column. Plain columns hold only opaque IDs, fixed codes, counts and amounts.
import pg from "pg";
import { z } from "zod";
import { PrivateError, type KeyReference, type PrivateCrypto } from "./crypto.js";
import type { Exchange } from "../execution/model.js";

export type AttemptStatus = "pending" | "valid" | "invalid" | "failed" | "uncertain" | "response_lost";
export type RequestRecord = {
  id: string; sequence: number;
  status: "reserved" | "abandoned" | "responded" | "no_response";
  reservedNanoUsd: number;
  chargeStatus: "pending" | "known" | "unknown" | "none";
  chargeNanoUsd: number | null;
  httpStatus: number | null; retryable: boolean | null; retryAfterMs: number | null;
  generationId: string | null; inputTokens: number | null; outputTokens: number | null;
  createdAt: Date; completedAt: Date | null;
  response: Exchange | null;
};
export type AttemptRecord = {
  id: string; experimentId: string; stage: string; status: AttemptStatus; outcomeCode: string | null;
  nextEligibleAt: Date | null; input: { input: unknown; request: unknown }; result: unknown;
  requests: RequestRecord[];
};
export type RequestOutcome = {
  status: "responded" | "no_response";
  httpStatus: number | null; retryable: boolean | null; retryAfterMs: number | null;
  generationId: string | null; inputTokens: number | null; outputTokens: number | null;
  chargeNanoUsd: number | null; completedAt: Date;
  // Absent when reconciled from the ledger after the reply itself was lost.
  response?: Exchange;
};

const anyJson = z.unknown();
const exchangeSchema: z.ZodType<Exchange> = z.union([
  z.object({ kind: z.literal("response"), status: z.number().int(), body: z.string(), retryAfter: z.string().nullable(), contentType: z.string().nullable() }).strict(),
  z.object({ kind: z.literal("no_response"), reason: z.enum(["timeout", "network"]) }).strict()
]);
const attemptInputSchema = z.object({ input: z.unknown(), request: z.unknown() }).strict();
const caseInputSchema = z.object({ headword: z.string() }).strict();
const expectationSchema = z.object({ finding: z.enum(["clear", "blocked"]), reason: z.string(), split: z.enum(["development", "held-out"]) }).strict();
export type Expectation = z.infer<typeof expectationSchema>;
export type CaseRecord = { caseId: string; position: number; input: z.infer<typeof caseInputSchema>; expectation: Expectation };

const number = (value: string | number | null) => value === null ? null : Number(value);

export async function createPrivateStore(options: {
  connectionString: string; storageKey: KeyReference; crypto: PrivateCrypto;
  // Evaluation only. Owner expectations and case scores use the dataset key;
  // stage execution never needs it and cannot read held-out labels.
  datasetKey?: KeyReference;
  // Internal fault-injection seam for tests. Called before each write.
  beforeWrite?: (operation: string) => Promise<void>;
}) {
  if (!options.storageKey.id.startsWith("ww-storage-") || (options.datasetKey && !options.datasetKey.id.startsWith("ww-dataset-")))
    throw new PrivateError("key_roles_invalid");
  // Key failures stop before any database work, decryption or dispatch.
  await options.crypto.verify(options.storageKey);
  if (options.datasetKey) await options.crypto.verify(options.datasetKey);
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 4 });
  // Never let a pool error event crash the process with driver text.
  pool.on("error", () => {});
  const key = options.storageKey;
  const seal = (recordId: string, payload: unknown) => options.crypto.encrypt(key, recordId, payload);
  const open = <T>(recordId: string, keyId: string, bytes: Buffer, schema: z.ZodType<T>) => {
    if (keyId !== key.id) throw new PrivateError("record_key_unavailable");
    return options.crypto.decrypt(key, recordId, bytes, schema);
  };
  const datasetKey = () => {
    if (!options.datasetKey) throw new PrivateError("dataset_key_required");
    return options.datasetKey;
  };
  const sealOwner = (recordId: string, payload: unknown) => options.crypto.encrypt(datasetKey(), recordId, payload);
  const openOwner = <T>(recordId: string, keyId: string, bytes: Buffer, schema: z.ZodType<T>) => {
    const owner = datasetKey();
    if (keyId !== owner.id) throw new PrivateError("record_key_unavailable");
    return options.crypto.decrypt(owner, recordId, bytes, schema);
  };
  // Driver errors can echo parameters, so only a fixed code escapes.
  const guard = async <T>(operation: string, work: () => Promise<T>, write = true): Promise<T> => {
    try {
      if (write) await options.beforeWrite?.(operation);
      return await work();
    } catch (error) {
      if (error instanceof PrivateError) throw error;
      throw new PrivateError("storage_unavailable");
    }
  };
  const read = <T>(operation: string, work: () => Promise<T>) => guard(operation, work, false);

  return {
    async close() { await pool.end(); },

    // The experiment and its frozen cases are saved together or not at all.
    async createExperiment(record: {
      id: string; stage: string; dataset: { id: string; version: number; ciphertextSha256: string };
      configurationFingerprint: string; implementationFingerprint: string; capNanoUsd: number; material: unknown;
      cases?: CaseRecord[];
    }) {
      const payload = await seal(`experiments:${record.id}:payload`, record.material);
      const cases = await Promise.all((record.cases ?? []).map(async c => [
        record.id, c.caseId, c.position, key.id,
        await seal(`cases:${record.id}:${c.caseId}:input`, caseInputSchema.parse(c.input)),
        datasetKey().id,
        await sealOwner(`cases:${record.id}:${c.caseId}:expectation`, expectationSchema.parse(c.expectation))
      ]));
      await guard("create_experiment", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `INSERT INTO private.experiments (id, stage, dataset_id, dataset_version, dataset_ciphertext_sha256,
               configuration_fingerprint, implementation_fingerprint, cap_nano_usd, key_id, payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [record.id, record.stage, record.dataset.id, record.dataset.version, record.dataset.ciphertextSha256,
              record.configurationFingerprint, record.implementationFingerprint, record.capNanoUsd, key.id, payload]);
          for (const row of cases) await client.query(
            `INSERT INTO private.cases (experiment_id, case_id, position, key_id, input_payload, expectation_key_id, expectation_payload)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`, row);
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
        finally { client.release(); }
      });
    },

    // Records the frozen summary digest once. Returns false if already finalized.
    async finalizeExperiment(id: string, summarySha256: string, at: Date): Promise<boolean> {
      const result = await guard("finalize_experiment", () => pool.query(
        "UPDATE private.experiments SET finalized_at = $2, summary_sha256 = $3 WHERE id = $1 AND finalized_at IS NULL", [id, at, summarySha256]));
      return result.rowCount === 1;
    },

    async listExperiments(): Promise<{ id: string; stage: string; datasetId: string; datasetVersion: number; configurationFingerprint: string; createdAt: Date }[]> {
      const { rows } = await read("list_experiments", () => pool.query(
        "SELECT id, stage, dataset_id, dataset_version, configuration_fingerprint, created_at FROM private.experiments ORDER BY created_at DESC"));
      return rows.map(row => ({ id: row.id, stage: row.stage, datasetId: row.dataset_id, datasetVersion: row.dataset_version,
        configurationFingerprint: row.configuration_fingerprint, createdAt: row.created_at }));
    },

    async readExperiment(id: string) {
      const { rows } = await read("read_experiment", () => pool.query("SELECT * FROM private.experiments WHERE id = $1", [id]));
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id as string, stage: row.stage as string,
        dataset: { id: row.dataset_id as string, version: row.dataset_version as number, ciphertextSha256: row.dataset_ciphertext_sha256 as string },
        configurationFingerprint: row.configuration_fingerprint as string,
        implementationFingerprint: row.implementation_fingerprint as string,
        capNanoUsd: Number(row.cap_nano_usd), createdAt: row.created_at as Date,
        finalizedAt: row.finalized_at as Date | null, summarySha256: row.summary_sha256 as string | null,
        material: await open(`experiments:${id}:payload`, row.key_id, row.payload, anyJson)
      };
    },

    // Stage inputs only, with the storage key.
    async readCases(experimentId: string): Promise<Omit<CaseRecord, "expectation">[]> {
      const { rows } = await read("read_cases", () => pool.query(
        "SELECT case_id, position, key_id, input_payload FROM private.cases WHERE experiment_id = $1 ORDER BY position", [experimentId]));
      return Promise.all(rows.map(async row => ({
        caseId: row.case_id, position: row.position,
        input: await open(`cases:${experimentId}:${row.case_id}:input`, row.key_id, row.input_payload, caseInputSchema)
      })));
    },

    // Owner expectations, with the dataset key. For the scorer only.
    async readExpectations(experimentId: string): Promise<Map<string, Expectation>> {
      datasetKey();
      const { rows } = await read("read_expectations", () => pool.query(
        "SELECT case_id, expectation_key_id, expectation_payload FROM private.cases WHERE experiment_id = $1", [experimentId]));
      return new Map(await Promise.all(rows.map(async row => [row.case_id as string,
        await openOwner(`cases:${experimentId}:${row.case_id}:expectation`, row.expectation_key_id, row.expectation_payload, expectationSchema)] as const)));
    },

    // Stable experiment/case/trial identity. Creates a fresh attempt ID once.
    async trialAttempt(experimentId: string, caseId: string, trialIndex: number, freshId: string): Promise<string> {
      return guard("trial_attempt", async () => {
        await pool.query(
          `INSERT INTO private.trials (experiment_id, case_id, trial_index, attempt_id) VALUES ($1,$2,$3,$4)
           ON CONFLICT (experiment_id, case_id, trial_index) DO NOTHING`, [experimentId, caseId, trialIndex, freshId]);
        const { rows } = await pool.query(
          "SELECT attempt_id FROM private.trials WHERE experiment_id = $1 AND case_id = $2 AND trial_index = $3",
          [experimentId, caseId, trialIndex]);
        return rows[0].attempt_id as string;
      });
    },

    async listTrials(experimentId: string): Promise<{ caseId: string; trialIndex: number; attemptId: string }[]> {
      const { rows } = await read("list_trials", () => pool.query(
        "SELECT case_id, trial_index, attempt_id FROM private.trials WHERE experiment_id = $1 ORDER BY case_id, trial_index", [experimentId]));
      return rows.map(row => ({ caseId: row.case_id, trialIndex: row.trial_index, attemptId: row.attempt_id }));
    },

    async createAttempt(record: { id: string; experimentId: string; stage: string; input: { input: unknown; request: unknown } }) {
      const payload = await seal(`attempts:${record.id}:input`, record.input);
      await guard("create_attempt", () => pool.query(
        `INSERT INTO private.attempts (id, experiment_id, stage, status, key_id, input_payload)
         VALUES ($1,$2,$3,'pending',$4,$5)`, [record.id, record.experimentId, record.stage, key.id, payload]));
    },

    async readAttempt(id: string): Promise<AttemptRecord | null> {
      const { attempt, requests } = await read("read_attempt", async () => ({
        attempt: (await pool.query("SELECT * FROM private.attempts WHERE id = $1", [id])).rows[0],
        requests: (await pool.query("SELECT * FROM private.requests WHERE attempt_id = $1 ORDER BY sequence", [id])).rows
      }));
      if (!attempt) return null;
      return {
        id, experimentId: attempt.experiment_id, stage: attempt.stage, status: attempt.status,
        outcomeCode: attempt.outcome_code, nextEligibleAt: attempt.next_eligible_at,
        input: await open(`attempts:${id}:input`, attempt.key_id, attempt.input_payload, attemptInputSchema) as AttemptRecord["input"],
        result: attempt.result_payload ? await open(`attempts:${id}:result`, attempt.key_id, attempt.result_payload, anyJson) : null,
        requests: await Promise.all(requests.map(async row => ({
          id: row.id, sequence: row.sequence, status: row.status,
          reservedNanoUsd: Number(row.reserved_nano_usd), chargeStatus: row.charge_status, chargeNanoUsd: number(row.charge_nano_usd),
          httpStatus: row.http_status, retryable: row.retryable, retryAfterMs: row.retry_after_ms,
          generationId: row.generation_id, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
          createdAt: row.created_at, completedAt: row.completed_at,
          response: row.response_payload ? await open(`requests:${row.id}:response`, row.key_id, row.response_payload, exchangeSchema) : null
        })))
      };
    },

    // Atomically requires settled charges + outstanding reservations + this
    // allowance to fit the experiment cap. Unknown charges keep their reservation.
    async reserveRequest(record: { requestId: string; attemptId: string; experimentId: string; sequence: number; reservedNanoUsd: number; at: Date }): Promise<boolean> {
      return guard("reserve_request", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const { rows: [experiment] } = await client.query("SELECT cap_nano_usd FROM private.experiments WHERE id = $1 FOR UPDATE", [record.experimentId]);
          const { rows: [spend] } = await client.query(
            `SELECT COALESCE(SUM(CASE WHEN r.charge_status = 'known' THEN r.charge_nano_usd
                                      WHEN r.charge_status IN ('pending', 'unknown') THEN r.reserved_nano_usd ELSE 0 END), 0) AS committed
               FROM private.requests r JOIN private.attempts a ON a.id = r.attempt_id WHERE a.experiment_id = $1`, [record.experimentId]);
          if (BigInt(spend.committed) + BigInt(record.reservedNanoUsd) > BigInt(experiment.cap_nano_usd)) {
            await client.query("ROLLBACK");
            return false;
          }
          await client.query(
            `INSERT INTO private.requests (id, attempt_id, sequence, status, reserved_nano_usd, charge_status, created_at)
             VALUES ($1,$2,$3,'reserved',$4,'pending',$5)`,
            [record.requestId, record.attemptId, record.sequence, record.reservedNanoUsd, record.at]);
          await client.query("COMMIT");
          return true;
        } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
        finally { client.release(); }
      });
    },

    // Only for a reservation with no durable dispatch intent: never sent.
    async abandonRequest(requestId: string) {
      await guard("abandon_request", () => pool.query(
        "UPDATE private.requests SET status = 'abandoned', charge_status = 'none' WHERE id = $1 AND status = 'reserved'", [requestId]));
    },

    async recordOutcome(requestId: string, outcome: RequestOutcome) {
      const payload = outcome.response ? await seal(`requests:${requestId}:response`, outcome.response) : null;
      await guard("record_outcome", () => pool.query(
        `UPDATE private.requests SET status = $2, http_status = $3, retryable = $4, retry_after_ms = $5,
           generation_id = $6, input_tokens = $7, output_tokens = $8,
           charge_status = $9, charge_nano_usd = $10, completed_at = $11, key_id = $12, response_payload = $13
         WHERE id = $1 AND status = 'reserved'`,
        [requestId, outcome.status, outcome.httpStatus, outcome.retryable, outcome.retryAfterMs,
          outcome.generationId, outcome.inputTokens, outcome.outputTokens,
          outcome.chargeNanoUsd === null ? "unknown" : "known", outcome.chargeNanoUsd, outcome.completedAt,
          payload ? key.id : null, payload]));
    },

    async finishAttempt(id: string, outcome: { status: Exclude<AttemptStatus, "pending">; outcomeCode: string | null; result?: unknown }) {
      const payload = outcome.result === undefined ? null : await seal(`attempts:${id}:result`, outcome.result);
      await guard("finish_attempt", () => pool.query(
        `UPDATE private.attempts SET status = $2, outcome_code = $3, result_payload = $4, next_eligible_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'pending'`, [id, outcome.status, outcome.outcomeCode, payload]));
    },

    async deferAttempt(id: string, nextEligibleAt: Date) {
      await guard("defer_attempt", () => pool.query(
        "UPDATE private.attempts SET next_eligible_at = $2, updated_at = now() WHERE id = $1 AND status = 'pending'", [id, nextEligibleAt]));
    },

    async saveCaseScore(experimentId: string, caseId: string, score: unknown) {
      const payload = await sealOwner(`case_scores:${experimentId}:${caseId}`, score);
      await guard("save_case_score", () => pool.query(
        `INSERT INTO private.case_scores (experiment_id, case_id, key_id, payload) VALUES ($1,$2,$3,$4)
         ON CONFLICT (experiment_id, case_id) DO UPDATE SET key_id = EXCLUDED.key_id, payload = EXCLUDED.payload, updated_at = now()`,
        [experimentId, caseId, datasetKey().id, payload]));
    },

    async readCaseScores(experimentId: string): Promise<{ caseId: string; score: unknown }[]> {
      datasetKey();
      const { rows } = await read("read_case_scores", () => pool.query(
        "SELECT * FROM private.case_scores WHERE experiment_id = $1 ORDER BY case_id", [experimentId]));
      return Promise.all(rows.map(async row => ({
        caseId: row.case_id, score: await openOwner(`case_scores:${experimentId}:${row.case_id}`, row.key_id, row.payload, anyJson)
      })));
    },

    // Accounting totals for status output: amounts and counts only.
    async spend(experimentId: string) {
      const { rows: [row] } = await read("spend", () => pool.query(
        `SELECT e.cap_nano_usd,
           COALESCE(SUM(r.charge_nano_usd) FILTER (WHERE r.charge_status = 'known'), 0) AS known,
           COALESCE(SUM(r.reserved_nano_usd) FILTER (WHERE r.charge_status IN ('pending', 'unknown')), 0) AS outstanding,
           COUNT(r.id) FILTER (WHERE r.charge_status IN ('pending', 'unknown')) AS unresolved,
           COUNT(r.id) FILTER (WHERE r.status <> 'abandoned') AS physical,
           MAX(r.completed_at) AS last_completed
         FROM private.experiments e
         LEFT JOIN private.attempts a ON a.experiment_id = e.id
         LEFT JOIN private.requests r ON r.attempt_id = a.id
         WHERE e.id = $1 GROUP BY e.cap_nano_usd`, [experimentId]));
      return { capNanoUsd: Number(row.cap_nano_usd), knownNanoUsd: Number(row.known), outstandingNanoUsd: Number(row.outstanding),
        unresolvedRequests: Number(row.unresolved), physicalRequests: Number(row.physical),
        lastCompletedAt: row.last_completed as Date | null };
    },

    // One runner per experiment. The session lock ends when its process stops,
    // so a crashed owner never blocks recovery and a live one cannot be raced.
    async lockExperiment(experimentId: string): Promise<() => Promise<void>> {
      const client = await read("lock_experiment", () => pool.connect());
      try {
        const { rows: [row] } = await client.query(
          "SELECT pg_try_advisory_lock(hashtext('wordwell:experiment'), hashtext($1)) AS locked", [experimentId]);
        if (!row.locked) throw new PrivateError("experiment_busy");
      } catch (error) {
        client.release();
        if (error instanceof PrivateError) throw error;
        throw new PrivateError("storage_unavailable");
      }
      return async () => {
        try { await client.query("SELECT pg_advisory_unlock(hashtext('wordwell:experiment'), hashtext($1))", [experimentId]); }
        finally { client.release(); }
      };
    }
  };
}
export type PrivateStore = Awaited<ReturnType<typeof createPrivateStore>>;
