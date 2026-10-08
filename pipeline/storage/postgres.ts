// Application-encrypted PostgreSQL storage for private pipeline records (#8).
// Callers pass and receive plain typed records; this module encrypts every
// payload with the storage key, binding each ciphertext to its table, row and
// column. Plain columns hold only opaque IDs, fixed codes, counts and amounts.
import pg from "pg";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { PrivateError, type KeyReference, type PrivateCrypto } from "./crypto.js";
import type { Exchange } from "../execution/model.js";

export type AttemptStatus = "pending" | "valid" | "invalid" | "failed" | "uncertain" | "response_lost" | "verification_unresolved";
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
  verifications?: { id: string; response: Exchange }[];
};
export function latestResponse(request: RequestRecord): Exchange | null {
  return request.verifications?.at(-1)?.response ?? request.response;
}
export type AttemptRecord = {
  id: string; experimentId: string | null; runId?: string | null; stage: string; status: AttemptStatus; outcomeCode: string | null;
  nextEligibleAt: Date | null; input: { input: unknown; request: unknown; provenance?: unknown }; result: unknown;
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
const attemptInputSchema = z.object({ input: z.unknown(), request: z.unknown(), provenance: z.unknown().optional() }).strict();
const caseInputSchema = z.object({ headword: z.string() }).strict();
const expectationSchema = z.object({ finding: z.enum(["clear", "blocked"]), reason: z.string(), split: z.enum(["development", "held-out"]) }).strict();
export type Expectation = z.infer<typeof expectationSchema>;
export type CaseRecord = { caseId: string; position: number; input: z.infer<typeof caseInputSchema>; expectation: Expectation };
export type CandidateClaim = { candidateId: string; runId: string; token: string; assert: () => Promise<void>;
  transaction: <T>(work: (client: pg.PoolClient) => Promise<T>) => Promise<T>; release: () => Promise<void> };
export type ExperimentLock = (() => Promise<void>) & { assert: () => Promise<void>;
  transaction: <T>(work: (client: pg.PoolClient) => Promise<T>) => Promise<T> };
export type ExecutionOwnership = Pick<CandidateClaim, "assert" | "transaction">;

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
  async function reconcileRequestAccounting(requestId: string, outcome: { chargeNanoUsd: number; generationId: string | null; inputTokens: number | null; outputTokens: number | null }) {
    await guard("reconcile_request_accounting", async () => {
      const { rows: [row] } = await pool.query("SELECT charge_status,charge_nano_usd FROM private.requests WHERE id=$1", [requestId]);
      if (row?.charge_status === "known" && Number(row.charge_nano_usd) !== outcome.chargeNanoUsd) throw new PrivateError("accounting_conflict");
      // Pricing an uncertain exchange never changes its execution outcome or
      // creates a usable reply. Terminal attempts remain immutable.
      await pool.query(`UPDATE private.requests SET charge_status='known',charge_nano_usd=$2,generation_id=COALESCE(generation_id,$3),
        input_tokens=COALESCE(input_tokens,$4),output_tokens=COALESCE(output_tokens,$5)
        WHERE id=$1 AND status IN ('responded','no_response') AND charge_status='unknown'`,
        [requestId, outcome.chargeNanoUsd, outcome.generationId, outcome.inputTokens, outcome.outputTokens]);
      const settled = (await pool.query("SELECT charge_status,charge_nano_usd FROM private.requests WHERE id=$1", [requestId])).rows[0];
      if (settled?.charge_status === "known" && Number(settled.charge_nano_usd) !== outcome.chargeNanoUsd) throw new PrivateError("accounting_conflict");
    });
  }

  return {
    async close() { await pool.end(); },
    reconcileRequestAccounting,

    // The experiment and its frozen cases are saved together or not at all.
    async createExperiment(record: {
      id: string; stage: string; dataset: { id: string; version: number; ciphertextSha256: string };
      configurationFingerprint: string; implementationFingerprint: string; capNanoUsd: number; material: unknown;
      cases?: CaseRecord[];
      // Other stages validate their frozen contracts before storage. Expectations
      // remain encrypted with the dataset identity, never in executor material.
      stageCases?: { caseId: string; position: number; input: unknown; expectation: unknown }[];
    }) {
      const payload = await seal(`experiments:${record.id}:payload`, record.material);
      const cases = await Promise.all((record.cases ?? record.stageCases ?? []).map(async c => [
        record.id, c.caseId, c.position, key.id,
        await seal(`cases:${record.id}:${c.caseId}:input`, record.stageCases ? c.input : caseInputSchema.parse(c.input)),
        datasetKey().id,
        await sealOwner(`cases:${record.id}:${c.caseId}:expectation`, record.stageCases ? c.expectation : expectationSchema.parse(c.expectation))
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
    async finalizeExperiment(id: string, summarySha256: string, at: Date, ownership: ExperimentLock, summary: unknown): Promise<boolean> {
      const payload = await seal(`experiments:${id}:summary`, summary);
      await ownership.assert();
      const result = await guard("finalize_experiment", () => ownership.transaction(client => client.query(
        `UPDATE private.experiments SET finalized_at=$2,summary_sha256=$3,finalized_summary_key_id=$4,finalized_summary_payload=$5
         WHERE id=$1 AND finalized_at IS NULL`, [id, at, summarySha256, key.id, payload])));
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
        frozenSummary: row.finalized_summary_payload ? await open(`experiments:${id}:summary`, row.finalized_summary_key_id, row.finalized_summary_payload, anyJson) : null,
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
    async readStageCases(experimentId: string) {
      const { rows } = await read("read_stage_cases", () => pool.query("SELECT case_id,position,key_id,input_payload FROM private.cases WHERE experiment_id=$1 ORDER BY position", [experimentId]));
      return Promise.all(rows.map(async row => ({ caseId: row.case_id as string, position: row.position as number,
        input: await open(`cases:${experimentId}:${row.case_id}:input`, row.key_id, row.input_payload, anyJson) })));
    },
    async readStageExpectations(experimentId: string) {
      datasetKey();
      const { rows } = await read("read_stage_expectations", () => pool.query("SELECT case_id,expectation_key_id,expectation_payload FROM private.cases WHERE experiment_id=$1", [experimentId]));
      return new Map(await Promise.all(rows.map(async row => [row.case_id as string,
        await openOwner(`cases:${experimentId}:${row.case_id}:expectation`, row.expectation_key_id, row.expectation_payload, anyJson)] as const)));
    },
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

    async createAttempt(record: { id: string; experimentId?: string; runId?: string; stage: string; input: { input: unknown; request: unknown; provenance?: unknown } }) {
      const payload = await seal(`attempts:${record.id}:input`, record.input);
      await guard("create_attempt", () => pool.query(
        `INSERT INTO private.attempts (id, experiment_id, stage, status, key_id, input_payload, run_id)
         VALUES ($1,$2,$3,'pending',$4,$5,$6)`, [record.id, record.experimentId ?? null, record.stage, key.id, payload, record.runId ?? null]));
    },

    async readAttempt(id: string): Promise<AttemptRecord | null> {
      const { attempt, requests, verifications } = await read("read_attempt", async () => ({
        attempt: (await pool.query("SELECT * FROM private.attempts WHERE id = $1", [id])).rows[0],
        requests: (await pool.query("SELECT * FROM private.requests WHERE attempt_id = $1 ORDER BY sequence", [id])).rows,
        verifications: (await pool.query("SELECT v.* FROM private.request_verifications v JOIN private.requests r ON r.id=v.request_id WHERE r.attempt_id=$1 ORDER BY v.sequence", [id])).rows
      }));
      if (!attempt) return null;
      return {
        id, experimentId: attempt.experiment_id, runId: attempt.run_id, stage: attempt.stage, status: attempt.status,
        outcomeCode: attempt.outcome_code, nextEligibleAt: attempt.next_eligible_at,
        input: await open(`attempts:${id}:input`, attempt.key_id, attempt.input_payload, attemptInputSchema) as AttemptRecord["input"],
        result: attempt.result_payload ? await open(`attempts:${id}:result`, attempt.key_id, attempt.result_payload, anyJson) : null,
        requests: await Promise.all(requests.map(async row => ({
          id: row.id, sequence: row.sequence, status: row.status,
          reservedNanoUsd: Number(row.reserved_nano_usd), chargeStatus: row.charge_status, chargeNanoUsd: number(row.charge_nano_usd),
          httpStatus: row.http_status, retryable: row.retryable, retryAfterMs: row.retry_after_ms,
          generationId: row.generation_id, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
          createdAt: row.created_at, completedAt: row.completed_at,
          response: row.response_payload ? await open(`requests:${row.id}:response`, row.key_id, row.response_payload, exchangeSchema) : null,
          verifications: await Promise.all(verifications.filter(v => v.request_id === row.id).map(async v => ({ id: v.id,
            response: await open(`request_verifications:${v.id}:payload`, v.key_id, v.payload, exchangeSchema) })))
        })))
      };
    },

    // Atomically requires settled charges + outstanding reservations + this
    // allowance to fit the experiment cap. Unknown charges keep their reservation.
    async reserveRequest(record: { requestId: string; attemptId: string; experimentId?: string; runId?: string; sequence: number; reservedNanoUsd: number; at: Date }): Promise<boolean> {
      return guard("reserve_request", async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const production = record.runId !== undefined;
          const ownerId = record.runId ?? record.experimentId;
          const { rows: [experiment] } = await client.query(`SELECT cap_nano_usd FROM private.${production ? "production_runs" : "experiments"} WHERE id = $1 FOR UPDATE`, [ownerId]);
          const { rows: [spend] } = await client.query(
            `SELECT COALESCE(SUM(CASE WHEN r.charge_status = 'known' THEN r.charge_nano_usd
                                      WHEN r.charge_status IN ('pending', 'unknown') THEN r.reserved_nano_usd ELSE 0 END), 0) AS committed
               FROM private.requests r JOIN private.attempts a ON a.id = r.attempt_id WHERE a.${production ? "run_id" : "experiment_id"} = $1`, [ownerId]);
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

    // A reservation with no intent or a durable cancellation was never sent.
    async abandonRequest(requestId: string, cancelled = false) {
      await guard("abandon_request", () => pool.query(
        `UPDATE private.requests SET status='abandoned',charge_status='none'
         WHERE id=$1 AND (status='reserved' OR ($2 AND status='no_response' AND charge_status='unknown' AND response_payload IS NULL))`, [requestId, cancelled]));
    },

    async recordOutcome(requestId: string, outcome: RequestOutcome) {
      const payload = outcome.response ? await seal(`requests:${requestId}:response`, outcome.response) : null;
      const written = await guard("record_outcome", () => pool.query(
        `UPDATE private.requests SET status = $2, http_status = $3, retryable = $4, retry_after_ms = $5,
           generation_id = $6, input_tokens = $7, output_tokens = $8,
           charge_status = $9, charge_nano_usd = $10, completed_at = $11, key_id = $12, response_payload = $13
         WHERE id = $1 AND status = 'reserved'`,
        [requestId, outcome.status, outcome.httpStatus, outcome.retryable, outcome.retryAfterMs,
          outcome.generationId, outcome.inputTokens, outcome.outputTokens,
          outcome.chargeNanoUsd === null ? "unknown" : "known", outcome.chargeNanoUsd, outcome.completedAt,
           payload ? key.id : null, payload]));
      if (!written.rowCount && outcome.chargeNanoUsd !== null) await reconcileRequestAccounting(requestId, { ...outcome, chargeNanoUsd: outcome.chargeNanoUsd });
    },

    async finishAttempt(id: string, outcome: { status: Exclude<AttemptStatus, "pending">; outcomeCode: string | null; result?: unknown }, ownership?: ExecutionOwnership) {
      const payload = outcome.result === undefined ? null : await seal(`attempts:${id}:result`, outcome.result);
      const write = (client: pg.Pool | pg.PoolClient) => client.query(
        `UPDATE private.attempts SET status = $2, outcome_code = $3, result_payload = $4, next_eligible_at = NULL, updated_at = now()
         WHERE id = $1 AND status = 'pending'`, [id, outcome.status, outcome.outcomeCode, payload]);
      await guard("finish_attempt", () => ownership ? ownership.transaction(write) : write(pool));
    },

    async saveRequestVerification(record: { id: string; requestId: string; sequence: number; response: Exchange }, ownership?: ExecutionOwnership) {
      const payload = await seal(`request_verifications:${record.id}:payload`, exchangeSchema.parse(record.response));
      await guard("save_request_verification", async () => {
        const write = async (client: pg.Pool | pg.PoolClient) => {
          const result = await client.query(`INSERT INTO private.request_verifications(id,request_id,sequence,key_id,payload)
            SELECT $1,r.id,$3,$4,$5 FROM private.requests r JOIN private.attempts a ON a.id=r.attempt_id
            WHERE r.id=$2 AND r.status='responded' AND r.response_payload IS NOT NULL AND a.status='pending'
              AND (SELECT count(*) FROM private.request_verifications WHERE request_id=r.id)=$3-1
            ON CONFLICT(id) DO NOTHING RETURNING id`, [record.id, record.requestId, record.sequence, key.id, payload]);
          if (!result.rowCount) {
            const { rows: [existing] } = await client.query("SELECT * FROM private.request_verifications WHERE id=$1", [record.id]);
            if (!existing || existing.request_id !== record.requestId || existing.sequence !== record.sequence ||
              !isDeepStrictEqual(await open(`request_verifications:${existing.id}:payload`, existing.key_id, existing.payload, exchangeSchema), record.response)) throw new PrivateError("verification_conflict");
          }
        };
        await (ownership ? ownership.transaction(write) : write(pool));
      });
    },

    async deferAttempt(id: string, nextEligibleAt: Date) {
      await guard("defer_attempt", () => pool.query(
        "UPDATE private.attempts SET next_eligible_at = $2, updated_at = now() WHERE id = $1 AND status = 'pending'", [id, nextEligibleAt]));
    },

    async saveCaseScore(experimentId: string, caseId: string, score: unknown, ownership?: ExecutionOwnership) {
      const payload = await sealOwner(`case_scores:${experimentId}:${caseId}`, score);
      const write = (client: pg.Pool | pg.PoolClient) => client.query(
        `INSERT INTO private.case_scores (experiment_id, case_id, key_id, payload) VALUES ($1,$2,$3,$4)
         ON CONFLICT (experiment_id, case_id) DO UPDATE SET key_id = EXCLUDED.key_id, payload = EXCLUDED.payload, updated_at = now()`,
        [experimentId, caseId, datasetKey().id, payload]);
      await guard("save_case_score", () => ownership ? ownership.transaction(write) : write(pool));
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

    async createProductionRun(record: { id: string; candidateId: string; capNanoUsd: number; material: unknown }) {
      const payload = await seal(`production_runs:${record.id}:payload`, record.material);
      await guard("create_production_run", () => pool.query(
        "INSERT INTO private.production_runs(id,candidate_id,cap_nano_usd,key_id,payload) VALUES($1,$2,$3,$4,$5)",
        [record.id, record.candidateId, record.capNanoUsd, key.id, payload]));
    },
    async readProductionRun(id: string) {
      const { rows: [row] } = await read("read_production_run", () => pool.query("SELECT * FROM private.production_runs WHERE id=$1", [id]));
      return row ? { id, candidateId: row.candidate_id as string, capNanoUsd: Number(row.cap_nano_usd), status: row.status as string,
        outcomeCode: row.outcome_code as string | null, material: await open(`production_runs:${id}:payload`, row.key_id, row.payload, anyJson) } : null;
    },
    // The session lock proves that the prior connection has ended before recovery.
    // A persistent token fences writes even if an obsolete process keeps running.
    async claimCandidate(candidateId: string, runId: string, recover = false): Promise<CandidateClaim> {
      const client = await read("claim_candidate", () => pool.connect());
      let locked = false;
      let connectionLost = false;
      const disconnected = () => { connectionLost = true; };
      client.on("error", disconnected);
      const token = randomUUID();
      try {
        locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('wordwell:candidate'),hashtext($1)) AS locked", [candidateId])).rows[0].locked;
        if (!locked) throw new PrivateError("candidate_busy");
        await client.query("BEGIN");
        await client.query("INSERT INTO private.candidate_claims(candidate_id) VALUES($1) ON CONFLICT DO NOTHING", [candidateId]);
        const { rows: [claim] } = await client.query("SELECT * FROM private.candidate_claims WHERE candidate_id=$1 FOR UPDATE", [candidateId]);
        const run = (await client.query("SELECT candidate_id,status FROM private.production_runs WHERE id=$1", [runId])).rows[0];
        if (run?.candidate_id !== candidateId) throw new PrivateError("claim_run_mismatch");
        if (["accepted", "rejected", "failed"].includes(run.status) && (!recover || claim.run_id !== runId)) throw new PrivateError("run_completed");
        if (claim.run_id && !(claim.run_id === runId && (recover || run.status === "paused"))) throw new PrivateError("candidate_recovery_required");
        await client.query("UPDATE private.candidate_claims SET run_id=$2,token=$3 WHERE candidate_id=$1", [candidateId, runId, token]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        let destroy = false;
        if (locked) try { await client.query("SELECT pg_advisory_unlock(hashtext('wordwell:candidate'),hashtext($1))", [candidateId]); } catch { destroy = true; }
        client.removeListener("error", disconnected);
        client.release(destroy || connectionLost);
        if (error instanceof PrivateError) throw error;
        throw new PrivateError("storage_unavailable");
      }
      let released = false;
      return { candidateId, runId, token,
        assert: async () => {
          if (released || connectionLost) throw new PrivateError("claim_stale");
          await read("assert_claim", async () => {
            // This query must use the lock-owning connection, never another pool session.
            const { rows } = await client.query("SELECT 1 FROM private.candidate_claims WHERE candidate_id=$1 AND run_id=$2 AND token=$3", [candidateId, runId, token]);
            if (!rows.length) throw new PrivateError("claim_stale");
          });
        },
        transaction: async work => {
          if (released || connectionLost) throw new PrivateError("claim_stale");
          return read("claim_transaction", async () => {
            await client.query("BEGIN");
            try {
              const { rows } = await client.query("SELECT 1 FROM private.candidate_claims WHERE candidate_id=$1 AND run_id=$2 AND token=$3 FOR UPDATE", [candidateId, runId, token]);
              if (!rows.length) throw new PrivateError("claim_stale");
              const result = await work(client);
              if (connectionLost) throw new PrivateError("claim_stale");
              await client.query("COMMIT");
              return result;
            } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
          });
        },
        release: async () => {
          released = true;
          let destroy = false;
          try { await client.query("SELECT pg_advisory_unlock(hashtext('wordwell:candidate'),hashtext($1))", [candidateId]); }
          catch { destroy = true; }
          finally { client.removeListener("error", disconnected); client.release(destroy || connectionLost); }
        }
      };
    },
    async productionTrial(runId: string, trialIndex: number, stage = "appropriateness"): Promise<string> {
      return guard("production_trial", async () => {
        await pool.query("INSERT INTO private.production_trials(run_id,trial_index,attempt_id,stage) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [runId, trialIndex, randomUUID(), stage]);
        return (await pool.query("SELECT attempt_id FROM private.production_trials WHERE run_id=$1 AND trial_index=$2 AND stage=$3", [runId, trialIndex, stage])).rows[0].attempt_id;
      });
    },
    async productionTrials(runId: string): Promise<{ stage: string; trialIndex: number; attemptId: string }[]> {
      const { rows } = await read("production_trials", () => pool.query("SELECT * FROM private.production_trials WHERE run_id=$1 ORDER BY stage,trial_index", [runId]));
      return rows.map(r => ({ stage: r.stage, trialIndex: r.trial_index, attemptId: r.attempt_id }));
    },
    async selectedProductionResult(candidateId: string, stage = "appropriateness") {
      const { rows: [row] } = await read("selected_result", () => pool.query(
        "SELECT r.* FROM private.stage_selections s JOIN private.production_results r ON r.id=s.result_id WHERE s.candidate_id=$1 AND s.stage=$2", [candidateId, stage]));
      return row ? { id: row.id as string, runId: row.run_id as string, reuseIdentity: row.reuse_identity as string,
        material: await open(`production_results:${row.id}:payload`, row.key_id, row.payload, anyJson) } : null;
    },
    // Result, selection/history, current authorization and claim release commit
    // together. Failed work updates only its run and retains earlier selections.
    async completeProduction(claim: CandidateClaim, record: { status: "paused" | "accepted" | "rejected" | "failed"; code?: string;
      result?: { id: string; reuseIdentity: string; material: unknown }; reusedResultId?: string;
       assessmentId?: string; promotionId?: string; keepClaim?: boolean; stage?: string; appropriatenessResultId?: string; usefulnessResultId?: string; plannerPromotionId?: string; continuing?: boolean }) {
      await claim.assert();
      const payload = record.result ? await seal(`production_results:${record.result.id}:payload`, record.result.material) : null;
      await guard("complete_production", async () => {
        await claim.transaction(async client => {
          if (record.result) {
            await client.query("INSERT INTO private.production_results VALUES($1,$2,$3,$4,$5,$6,$7)", [record.result.id, claim.runId, claim.candidateId, record.stage ?? "appropriateness", record.result.reuseIdentity, key.id, payload]);
            await client.query("INSERT INTO private.stage_selections VALUES($1,$2,$3) ON CONFLICT(candidate_id,stage) DO UPDATE SET result_id=EXCLUDED.result_id", [claim.candidateId, record.stage ?? "appropriateness", record.result.id]);
            await client.query("INSERT INTO private.selection_history(id,candidate_id,stage,result_id,run_id) VALUES($1,$2,$3,$4,$5)", [randomUUID(), claim.candidateId, record.stage ?? "appropriateness", record.result.id, claim.runId]);
          }
          const resultId = record.result?.id ?? record.reusedResultId;
          if (resultId && record.assessmentId) await client.query("INSERT INTO private.reuse_authorizations(run_id,result_id,assessment_id,promotion_id,appropriateness_result_id,usefulness_result_id,planner_promotion_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [claim.runId, resultId, record.assessmentId, record.promotionId ?? null, record.appropriatenessResultId ?? null, record.usefulnessResultId ?? null, record.plannerPromotionId ?? null]);
          await client.query("UPDATE private.production_runs SET status=$2,outcome_code=$3 WHERE id=$1", [claim.runId, record.continuing ? "pending" : record.status, record.code ?? null]);
          if (!record.keepClaim) await client.query("UPDATE private.candidate_claims SET run_id=NULL,token=NULL WHERE candidate_id=$1 AND token=$2", [claim.candidateId, claim.token]);
        });
      });
    },
    async productionSpend(runId: string) {
      const { rows: [row] } = await read("production_spend", () => pool.query(
        `SELECT p.cap_nano_usd, COALESCE(sum(r.charge_nano_usd) FILTER(WHERE r.charge_status='known'),0) AS known,
          COALESCE(sum(r.reserved_nano_usd) FILTER(WHERE r.charge_status IN ('pending','unknown')),0) AS outstanding,
          count(r.id) FILTER(WHERE r.charge_status IN ('pending','unknown')) AS unresolved,
          count(r.id) FILTER(WHERE r.status <> 'abandoned') AS physical
         FROM private.production_runs p LEFT JOIN private.attempts a ON a.run_id=p.id LEFT JOIN private.requests r ON r.attempt_id=a.id
         WHERE p.id=$1 GROUP BY p.cap_nano_usd`, [runId]));
      return { capNanoUsd: Number(row.cap_nano_usd), knownNanoUsd: Number(row.known), outstandingNanoUsd: Number(row.outstanding),
        unresolvedRequests: Number(row.unresolved), physicalRequests: Number(row.physical) };
    },
    async savePlannerReview(record: { id: string; experimentId: string; attemptId: string; configurationFingerprint: string; material: unknown }) {
      const payload = await seal(`planner_trial_reviews:${record.id}:payload`, record.material);
      await guard("save_planner_review", () => pool.query("INSERT INTO private.planner_trial_reviews(id,experiment_id,attempt_id,configuration_fingerprint,key_id,payload) VALUES($1,$2,$3,$4,$5,$6)",
        [record.id, record.experimentId, record.attemptId, record.configurationFingerprint, key.id, payload]));
    },
    async plannerReviews(experimentId: string) {
      const { rows } = await read("planner_reviews", () => pool.query("SELECT * FROM private.planner_trial_reviews WHERE experiment_id=$1 ORDER BY created_at DESC,id DESC", [experimentId]));
      return Promise.all(rows.map(async row => ({ id: row.id as string, attemptId: row.attempt_id as string, configurationFingerprint: row.configuration_fingerprint as string,
        material: await open(`planner_trial_reviews:${row.id}:payload`, row.key_id, row.payload, anyJson) })));
    },
    async savePlannerPromotion(record: { id: string; experimentId: string; configurationFingerprint: string; decision: "promote" | "do_not_promote"; material: unknown }) {
      const payload = await seal(`planner_promotions:${record.id}:payload`, record.material);
      await guard("save_planner_promotion", () => pool.query("INSERT INTO private.planner_promotions(id,experiment_id,configuration_fingerprint,decision,key_id,payload) VALUES($1,$2,$3,$4,$5,$6)",
        [record.id, record.experimentId, record.configurationFingerprint, record.decision, key.id, payload]));
    },
    async currentPlannerPromotion(configurationFingerprint: string) {
      const { rows: [row] } = await read("planner_promotion", () => pool.query("SELECT * FROM private.planner_promotions WHERE configuration_fingerprint=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [configurationFingerprint]));
      return row ? { id: row.id as string, experimentId: row.experiment_id as string, decision: row.decision as "promote" | "do_not_promote",
        material: await open(`planner_promotions:${row.id}:payload`, row.key_id, row.payload, anyJson) } : null;
    },
    async savePromotionAssessment(record: { id: string; experimentId: string; configurationFingerprint: string; ruleIdentity: string; evidenceIdentity: string; qualifies: boolean; material: unknown }) {
      const payload = await seal(`promotion_assessments:${record.id}:payload`, record.material);
      await guard("save_promotion_assessment", async () => {
        await pool.query(
        "INSERT INTO private.promotion_assessments(id,experiment_id,configuration_fingerprint,rule_identity,evidence_identity,qualifies,key_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
        [record.id, record.experimentId, record.configurationFingerprint, record.ruleIdentity, record.evidenceIdentity, record.qualifies, key.id, payload]);
        const { rows: [row] } = await pool.query("SELECT * FROM private.promotion_assessments WHERE id=$1", [record.id]);
        if (!isDeepStrictEqual(await open(`promotion_assessments:${record.id}:payload`, row.key_id, row.payload, anyJson), record.material)) throw new PrivateError("assessment_identity_conflict");
      });
    },
    async readPromotionAssessment(id: string) {
      const { rows: [row] } = await read("read_promotion_assessment", () => pool.query("SELECT * FROM private.promotion_assessments WHERE id=$1", [id]));
      return row ? { id, configurationFingerprint: row.configuration_fingerprint as string, qualifies: row.qualifies as boolean,
        material: await open(`promotion_assessments:${id}:payload`, row.key_id, row.payload, anyJson) } : null;
    },
    async recordPromotion(record: { id: string; assessmentId?: string; stage?: "appropriateness" | "usefulness"; configurationFingerprint: string; decision: "promote" | "do_not_promote"; material: unknown }) {
      const payload = await seal(`stage_promotions:${record.id}:payload`, record.material);
      await guard("record_promotion", async () => {
        if (record.stage !== "usefulness") {
          const { rows: [assessment] } = await pool.query("SELECT * FROM private.promotion_assessments WHERE id=$1", [record.assessmentId]);
          if (!assessment || assessment.configuration_fingerprint !== record.configurationFingerprint || (record.decision === "promote" && !assessment.qualifies)) throw new PrivateError("promotion_evidence_invalid");
        }
        await pool.query("INSERT INTO private.stage_promotions(id,configuration_fingerprint,assessment_id,decision,key_id,payload,stage) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [record.id, record.configurationFingerprint, record.assessmentId ?? null, record.decision, key.id, payload, record.stage ?? "appropriateness"]);
      });
    },
    async currentPromotion(configurationFingerprint: string) {
      const { rows: [row] } = await read("current_promotion", () => pool.query(
        "SELECT * FROM private.stage_promotions WHERE configuration_fingerprint=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [configurationFingerprint]));
      return row ? { id: row.id as string, decision: row.decision as "promote" | "do_not_promote", assessmentId: row.assessment_id as string,
        material: await open(`stage_promotions:${row.id}:payload`, row.key_id, row.payload, anyJson) } : null;
    },
    async productionHistory(candidateId: string) {
      const { rows } = await read("production_history", () => pool.query("SELECT id,result_id,run_id,created_at FROM private.selection_history WHERE candidate_id=$1 ORDER BY created_at,id", [candidateId]));
      return rows.map(row => ({ id: row.id as string, resultId: row.result_id as string, runId: row.run_id as string }));
    },
    async productionAuthorizations(runId: string) {
      return (await read("production_authorizations", () => pool.query("SELECT a.result_id,a.assessment_id,a.promotion_id,a.appropriateness_result_id,a.usefulness_result_id,a.planner_promotion_id,r.stage FROM private.reuse_authorizations a JOIN private.production_results r ON r.id=a.result_id WHERE a.run_id=$1 ORDER BY a.created_at,a.result_id", [runId]))).rows;
    },
    async candidateClaim(candidateId: string) {
      const { rows: [row] } = await read("candidate_claim", () => pool.query("SELECT run_id FROM private.candidate_claims WHERE candidate_id=$1", [candidateId]));
      return row?.run_id as string | null ?? null;
    },

    // One runner per experiment. The session lock ends when its process stops,
    // so a crashed owner never blocks recovery and a live one cannot be raced.
    async lockExperiment(experimentId: string): Promise<ExperimentLock> {
      const client = await read("lock_experiment", () => pool.connect());
      let connectionLost = false;
      const disconnected = () => { connectionLost = true; };
      client.on("error", disconnected);
      try {
        const { rows: [row] } = await client.query(
          "SELECT pg_try_advisory_lock(hashtext('wordwell:experiment'), hashtext($1)) AS locked", [experimentId]);
        if (!row.locked) throw new PrivateError("experiment_busy");
      } catch (error) {
        client.removeListener("error", disconnected);
        client.release(connectionLost);
        if (error instanceof PrivateError) throw error;
        throw new PrivateError("storage_unavailable");
      }
      let released = false;
      const assert = async () => {
        if (released || connectionLost) throw new PrivateError("experiment_lock_lost");
        await read("assert_experiment_lock", () => client.query("SELECT 1"));
      };
      const release = async () => {
        released = true;
        let destroy = connectionLost;
        try { await client.query("SELECT pg_advisory_unlock(hashtext('wordwell:experiment'), hashtext($1))", [experimentId]); }
        catch { destroy = true; throw new PrivateError("storage_unavailable"); }
        finally { client.removeListener("error", disconnected); client.release(destroy); }
      };
      return Object.assign(release, { assert,
        transaction: async <T>(work: (client: pg.PoolClient) => Promise<T>) => {
          await assert();
          return read("experiment_transaction", async () => {
            await client.query("BEGIN");
            try {
              const result = await work(client);
              if (connectionLost) throw new PrivateError("experiment_lock_lost");
              await client.query("COMMIT");
              return result;
            } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
          });
        }
      });
    }
  };
}
export type PrivateStore = Awaited<ReturnType<typeof createPrivateStore>>;
