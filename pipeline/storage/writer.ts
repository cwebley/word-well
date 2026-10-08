import pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPrivateStore, type CandidateClaim } from "./postgres.js";
import { PrivateError } from "./crypto.js";

// A writer extension leaves the exact evaluated gate/planner storage implementation intact.
export async function createWriterStore(options: Parameters<typeof createPrivateStore>[0]) {
  const base = await createPrivateStore(options), pool = new pg.Pool({ connectionString: options.connectionString, max: 2 });
  pool.on("error", () => {});
  const key = options.storageKey;
  const seal = (id: string, value: unknown) => options.crypto.encrypt(key, id, value);
  const open = (id: string, row: { key_id: string; payload: Buffer }) => {
    if (row.key_id !== key.id) throw new PrivateError("record_key_unavailable");
    return options.crypto.decrypt(key, id, row.payload, z.unknown());
  };
  async function guard<T>(operation: string, work: () => Promise<T>, write = true) {
    try { if (write) await options.beforeWrite?.(operation); return await work(); }
    catch (error) { if (error instanceof PrivateError) throw error; throw new PrivateError("storage_unavailable"); }
  }
  return { ...base,
    close: async () => { await Promise.all([base.close(), pool.end()]); },
    async saveWriterReview(record: { id: string; experimentId: string; attemptId: string; configurationFingerprint: string; material: unknown }) {
      const payload = await seal(`writer_trial_reviews:${record.id}:payload`, record.material);
      await guard("save_writer_review", () => pool.query("INSERT INTO private.writer_trial_reviews(id,experiment_id,attempt_id,configuration_fingerprint,key_id,payload) VALUES($1,$2,$3,$4,$5,$6)",
        [record.id, record.experimentId, record.attemptId, record.configurationFingerprint, key.id, payload]));
    },
    async writerReviews(experimentId: string) {
      const { rows } = await guard("writer_reviews", () => pool.query("SELECT * FROM private.writer_trial_reviews WHERE experiment_id=$1 ORDER BY created_at DESC,id DESC", [experimentId]), false);
      return Promise.all(rows.map(async row => ({ id: row.id as string, attemptId: row.attempt_id as string, configurationFingerprint: row.configuration_fingerprint as string,
        material: await open(`writer_trial_reviews:${row.id}:payload`, row) })));
    },
    async saveWriterPromotion(record: { id: string; experimentId: string; configurationFingerprint: string; decision: "promote" | "do_not_promote"; material: unknown }) {
      const payload = await seal(`writer_promotions:${record.id}:payload`, record.material);
      await guard("save_writer_promotion", () => pool.query("INSERT INTO private.writer_promotions(id,experiment_id,configuration_fingerprint,decision,key_id,payload) VALUES($1,$2,$3,$4,$5,$6)",
        [record.id, record.experimentId, record.configurationFingerprint, record.decision, key.id, payload]));
    },
    async currentWriterPromotion(configurationFingerprint: string) {
      const { rows: [row] } = await guard("writer_promotion", () => pool.query("SELECT * FROM private.writer_promotions WHERE configuration_fingerprint=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [configurationFingerprint]), false);
      return row ? { id: row.id as string, experimentId: row.experiment_id as string, decision: row.decision as "promote" | "do_not_promote",
        material: await open(`writer_promotions:${row.id}:payload`, row) } : null;
    },
    async writerAuthorizations(runId: string) {
      return (await guard("writer_authorizations", () => pool.query("SELECT * FROM private.writer_authorizations WHERE run_id=$1 ORDER BY created_at,result_id", [runId]), false)).rows;
    },
    async completeWriter(claim: CandidateClaim, record: { result?: { id: string; reuseIdentity: string; material: unknown }; reusedResultId?: string;
      authorization: { assessmentId: string; appropriatenessResultId: string; usefulnessResultId: string; plannerResultId: string; plannerPromotionId?: string; writerPromotionId?: string } }) {
      await claim.assert();
      const payload = record.result ? await seal(`production_results:${record.result.id}:payload`, record.result.material) : null;
      await guard("complete_writer", () => claim.transaction(async client => {
        if (record.result) {
          await client.query("INSERT INTO private.production_results VALUES($1,$2,$3,$4,$5,$6,$7)", [record.result.id, claim.runId, claim.candidateId, "writer", record.result.reuseIdentity, key.id, payload]);
          await client.query("INSERT INTO private.stage_selections VALUES($1,$2,$3) ON CONFLICT(candidate_id,stage) DO UPDATE SET result_id=EXCLUDED.result_id", [claim.candidateId, "writer", record.result.id]);
          await client.query("INSERT INTO private.selection_history(id,candidate_id,stage,result_id,run_id) VALUES($1,$2,$3,$4,$5)", [randomUUID(), claim.candidateId, "writer", record.result.id, claim.runId]);
        }
        const resultId = record.result?.id ?? record.reusedResultId;
        if (!resultId) throw new PrivateError("writer_selection_missing");
        const a = record.authorization;
        await client.query("INSERT INTO private.writer_authorizations(run_id,result_id,assessment_id,appropriateness_result_id,usefulness_result_id,planner_result_id,planner_promotion_id,writer_promotion_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
          [claim.runId, resultId, a.assessmentId, a.appropriatenessResultId, a.usefulnessResultId, a.plannerResultId, a.plannerPromotionId ?? null, a.writerPromotionId ?? null]);
        await client.query("UPDATE private.production_runs SET status='accepted',outcome_code=NULL WHERE id=$1", [claim.runId]);
        await client.query("UPDATE private.candidate_claims SET run_id=NULL,token=NULL WHERE candidate_id=$1 AND token=$2", [claim.candidateId, claim.token]);
      }));
    }
  };
}
export type WriterStore = Awaited<ReturnType<typeof createWriterStore>>;
