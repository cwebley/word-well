import pg from "pg";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { digest, PrivateError, type KeyReference, type PrivateCrypto } from "./crypto.js";

export async function createPlannerRevalidationStore(options: { connectionString: string; storageKey: KeyReference; crypto: PrivateCrypto }) {
  const { storageKey: key, crypto } = options;
  if (!key.id.startsWith("ww-storage-")) throw new PrivateError("key_roles_invalid");
  await crypto.verify(key);
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 2 });
  pool.on("error", () => {});
  async function guard<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { if (error instanceof PrivateError) throw error; throw new PrivateError("storage_unavailable"); }
  }
  async function read(id: string) {
    return guard(async () => {
      const row = (await pool.query("SELECT * FROM private.planner_revalidations WHERE id=$1", [id])).rows[0];
      if (!row) return null;
      if (row.key_id !== key.id) throw new PrivateError("record_key_unavailable");
      return { id: row.id as string, sourceExperimentId: row.source_experiment_id as string,
        configurationFingerprint: row.configuration_fingerprint as string, implementation: row.implementation_fingerprint as string,
        ruleIdentity: row.rule_identity as string, sourceEvidenceIdentity: row.source_evidence_identity as string,
        material: await crypto.decrypt(key, `planner_revalidations:${id}:payload`, row.payload, z.unknown()) };
    });
  }
  return { close: () => pool.end(), read,
    async save(record: { id: string; sourceExperimentId: string; configurationFingerprint: string; implementation: string; ruleIdentity: string; sourceEvidenceIdentity: string; material: unknown }) {
      const payload = await crypto.encrypt(key, `planner_revalidations:${record.id}:payload`, record.material);
      await guard(() => pool.query(`INSERT INTO private.planner_revalidations
        (id,source_experiment_id,configuration_fingerprint,implementation_fingerprint,rule_identity,source_evidence_identity,key_id,payload)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING`,
        [record.id, record.sourceExperimentId, record.configurationFingerprint, record.implementation, record.ruleIdentity, record.sourceEvidenceIdentity, key.id, payload]));
      const saved = await read(record.id);
      if (!saved || !isDeepStrictEqual(saved, record)) throw new PrivateError("revalidation_conflict");
    },
    async sourceEvidenceIdentity(experimentId: string) {
      return guard(async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
          const source = [];
          for (const [table, where] of [
            ["experiments", "id=$1"], ["cases", "experiment_id=$1"], ["trials", "experiment_id=$1"], ["attempts", "experiment_id=$1"],
            ["requests", "attempt_id IN (SELECT id FROM private.attempts WHERE experiment_id=$1)"],
            ["request_verifications", "request_id IN (SELECT r.id FROM private.requests r JOIN private.attempts a ON a.id=r.attempt_id WHERE a.experiment_id=$1)"]
          ]) {
            const rows = (await client.query(`SELECT row_to_json(t)::text AS value FROM private.${table} t WHERE ${where} ORDER BY row_to_json(t)::text`, [experimentId])).rows;
            source.push({ table, rows: rows.map(row => row.value) });
          }
          await client.query("COMMIT");
          return digest(JSON.stringify(source));
        } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
        finally { client.release(); }
      });
    }
  };
}
export type PlannerRevalidationStore = Awaited<ReturnType<typeof createPlannerRevalidationStore>>;
