import pg from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PrivateError, type PrivateCrypto, type KeyReference } from "../storage/crypto.js";
import { fingerprint } from "../config.js";
import { assembleCandidate, verifyCandidate, publicProjection, PUBLICATION_CHECKS, type PublicationMaterial, type PublicationCandidate } from "./assemble.js";
import { checkAuthorization, checkReview, reviewSchema, type PublicationReview, type PublicationAuthorization } from "./checks.js";
import { resolveMeanings, type MeaningRevision } from "./identities.js";

export function createPublisher(options: {
  connectionString: string; storageKey: KeyReference; crypto: PrivateCrypto;
  authorize: PublicationAuthorization; requiredChecks?: string;
  beforeWrite?: (operation: "revision" | "projection" | "after-projection") => Promise<void>;
}) {
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 3 });
  pool.on("error", () => {});
  const key = options.storageKey;
  const seal = (id: string, value: unknown) => options.crypto.encrypt(key, id, value);
  async function open<T>(table: string, id: string, row: { key_id: string; payload: Buffer }, schema: z.ZodType<T>) {
    if (row.key_id !== key.id) throw new PrivateError("record_key_unavailable");
    return options.crypto.decrypt(key, `${table}:${id}:payload`, row.payload, schema);
  }
  async function loadCandidate(client: pg.Pool | pg.PoolClient, id: string) {
    const { rows: [row] } = await client.query("SELECT * FROM private.publication_candidates WHERE id=$1", [id]);
    if (!row) throw new PrivateError("publication_candidate_missing");
    const candidate = await open("publication_candidates", id, row, z.unknown());
    return verifyCandidate(candidate as PublicationCandidate);
  }
  async function guard<T>(work: () => Promise<T>) {
    try { return await work(); }
    catch (error) {
      if (error instanceof PrivateError) throw error;
      if (error instanceof z.ZodError) throw new PrivateError("publication_contract_invalid");
      throw new PrivateError("publication_storage_unavailable");
    }
  }
  return {
    close: () => pool.end(),
    async assembleCandidate(material: PublicationMaterial) {
      return guard(async () => {
        const candidate = assembleCandidate(material), payload = await seal(`publication_candidates:${candidate.id}:payload`, candidate);
        await pool.query("INSERT INTO private.publication_candidates(id,lesson_id,key_id,payload) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [candidate.id, candidate.material.lessonId, key.id, payload]);
        const saved = await loadCandidate(pool, candidate.id);
        if (fingerprint(saved) !== fingerprint(candidate)) throw new PrivateError("publication_candidate_conflict");
        return saved;
      });
    },
    getReviewCandidate: (id: string) => guard(() => loadCandidate(pool, id)),
    async recordReview(value: PublicationReview) {
      return guard(async () => {
        const review = reviewSchema.parse(value), candidate = await loadCandidate(pool, review.candidateId);
        // Rejections are retained too. Approval must bind the exact displayed artifact.
        if (review.evidenceIdentity !== candidate.evidenceIdentity || review.attributionIdentity !== candidate.attributionIdentity || review.checksIdentity !== candidate.checksIdentity)
          throw new PrivateError("publication_approval_stale");
        const id = randomUUID(), payload = await seal(`publication_reviews:${id}:payload`, review);
        await pool.query("INSERT INTO private.publication_reviews(id,candidate_id,key_id,payload) VALUES($1,$2,$3,$4)", [id, candidate.id, key.id, payload]);
        return id;
      });
    },
    async publishCandidate(id: string, expectedVersion: number) {
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new PrivateError("publication_version_invalid");
      return guard(async () => {
        // A serialization retry only repeats saved-record reads and writes.
        for (let retry = 0; retry < 3; retry++) {
          const client = await pool.connect();
          try {
            await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
            const candidate = await loadCandidate(client, id);
            await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`wordwell:publication:${candidate.material.lessonId}`]);
            const { rows: [already] } = await client.query("SELECT publication_version FROM private.publication_revisions WHERE candidate_id=$1", [id]);
            // Idempotent receipt, not reactivation of old content or withdrawal.
            if (already) { await client.query("COMMIT"); return { publicationVersion: Number(already.publication_version), reused: true }; }
            const { rows: [reviewRow] } = await client.query("SELECT * FROM private.publication_reviews WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [id]);
            if (!reviewRow) throw new PrivateError("publication_not_approved");
            const review = await open("publication_reviews", reviewRow.id, reviewRow, reviewSchema);
            checkReview(candidate, review, options.requiredChecks ?? PUBLICATION_CHECKS);
            // Production evidence validation is not wired yet. Controlled fixtures
            // exercise the transaction without creating a production bypass.
            if (candidate.material.executionKind !== "controlled") throw new PrivateError("publication_live_authorization_unimplemented");
            const authorization = await checkAuthorization(client, candidate, options.authorize);
            const { rows: [previousRow] } = await client.query("SELECT * FROM private.publication_revisions WHERE lesson_id=$1 ORDER BY publication_version DESC LIMIT 1", [candidate.material.lessonId]);
            const { rows: [publicRow] } = await client.query("SELECT normalized_headword FROM public.published_lessons WHERE id=$1", [candidate.material.lessonId]);
            if (publicRow && publicRow.normalized_headword !== candidate.publicFields.normalizedHeadword) throw new PrivateError("publication_lesson_identity_conflict");
            if (publicRow && !previousRow) throw new PrivateError("publication_history_missing");
            const version = previousRow ? Number(previousRow.publication_version) : 0;
            if (version !== expectedVersion) throw new PrivateError("publication_version_conflict");
            const previous = previousRow ? await open("publication_revisions", previousRow.candidate_id, previousRow, z.unknown()) as { meanings: MeaningRevision[] } : null;
            const meanings = resolveMeanings(candidate, previous?.meanings ?? []);
            const projection = publicProjection(candidate, version + 1, meanings.map(meaning => meaning.id));
            const payload = await seal(`publication_revisions:${id}:payload`, { candidateId: id, meanings, authorization, reviewId: reviewRow.id,
              evidenceIdentity: candidate.evidenceIdentity, attributionIdentity: candidate.attributionIdentity, checksIdentity: candidate.checksIdentity });
            await options.beforeWrite?.("revision");
            await client.query("INSERT INTO private.publication_revisions(candidate_id,lesson_id,publication_version,review_id,key_id,payload) VALUES($1,$2,$3,$4,$5,$6)",
              [id, candidate.material.lessonId, version + 1, reviewRow.id, key.id, payload]);
            await options.beforeWrite?.("projection");
            await client.query("INSERT INTO public.published_lessons(id,normalized_headword,record,available) VALUES($1,$2,$3,true) ON CONFLICT(id) DO UPDATE SET record=EXCLUDED.record,available=true,withdrawal_reason=NULL",
              [projection.lessonId, projection.normalizedHeadword, projection]);
            // The existing lesson trigger retires Practice in this same transaction.
            await options.beforeWrite?.("after-projection");
            await client.query("COMMIT");
            return { publicationVersion: version + 1, reused: false };
          } catch (error) {
            await client.query("ROLLBACK");
            if ((error as { code?: string }).code === "40001" && retry < 2) continue;
            throw error;
          } finally { client.release(); }
        }
        throw new PrivateError("publication_concurrency_retry_exhausted");
      });
    }
  };
}
