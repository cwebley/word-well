import { randomUUID } from "node:crypto";
import pg from "pg";
import { z } from "zod";
import { fingerprint } from "../config.js";
import { bundleSchema, type EvidenceBundle } from "../sources/bundle.js";
import { PrivateError, type KeyReference, type PrivateCrypto } from "./crypto.js";

export const SOURCE_TABLES = ["source_artifacts", "source_locations", "source_bundles", "source_import_attempts", "source_entries", "source_meanings", "source_concepts", "source_relations", "source_supplements", "source_frequency", "intake_candidates", "intake_resolutions", "intake_assessments"];
const candidateSchema = z.object({ headword: z.string(), lessonId: z.string() }).strict();
const json = z.record(z.string(), z.unknown());
type Unit = { sql: string; parameters: unknown[]; location?: unknown[] };
export function evidenceIdentity(bundle: EvidenceBundle) {
  return fingerprint({ ...bundle, artifacts: bundle.artifacts.map(a => ({ ...a, path: "" })) });
}

export async function createSourceStore(options: { connectionString: string; storageKey: KeyReference; crypto: PrivateCrypto }) {
  const { storageKey: key, crypto } = options;
  if (!key.id.startsWith("ww-storage-")) throw new PrivateError("key_roles_invalid");
  await crypto.verify(key);
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 4 });
  pool.on("error", () => {});
  const seal = (id: string, value: unknown) => crypto.encrypt(key, id, value);
  async function open<T>(id: string, row: { key_id: string; payload: Buffer }, schema: z.ZodType<T>): Promise<T> {
    if (row.key_id !== key.id) throw new PrivateError("record_key_unavailable");
    return crypto.decrypt(key, id, row.payload, schema);
  }
  async function guard<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { if (error instanceof PrivateError) throw error; throw new PrivateError("source_storage_unavailable"); }
  }
  async function readBundle(id: string, query: pg.Pool | pg.PoolClient = pool): Promise<EvidenceBundle> {
    const { rows } = await query.query("SELECT * FROM private.source_bundles WHERE id=$1", [id]);
    if (!rows[0]) throw new PrivateError("bundle_not_found");
    const header = await open(`source_bundles:${id}:payload`, rows[0], json);
    if (!header.evidence) throw new PrivateError("bundle_evidence_missing");
    const entries = (await query.query("SELECT * FROM private.source_entries WHERE bundle_id=$1 ORDER BY source, source_order", [id])).rows.map(r => ({ source: r.source, id: r.source_id, headword: r.headword, pos: r.original_pos, order: r.source_order, role: r.role, raw: r.raw_record, rawSha256: r.raw_sha256, locator: r.locator, data: r.data }));
    // Restore the exact array order used by the importer, independent of SQL collation.
    const order = header.order as { entries: string[]; meanings: string[]; concepts: string[] };
    entries.sort((a, b) => order.entries.indexOf(`${a.source}:${a.id}`) - order.entries.indexOf(`${b.source}:${b.id}`));
    const meanings = (await query.query("SELECT * FROM private.source_meanings WHERE bundle_id=$1", [id])).rows.map(r => ({ source: r.source, entryId: r.entry_id, id: r.source_id, order: r.source_order, conceptId: r.concept_id, relations: r.data.relations, data: r.data.body }));
    meanings.sort((a, b) => order.meanings.indexOf(`${a.source}:${a.id}`) - order.meanings.indexOf(`${b.source}:${b.id}`));
    const concepts = (await query.query("SELECT * FROM private.source_concepts WHERE bundle_id=$1", [id])).rows.map(r => ({ source: "oewn", id: r.source_id, order: r.source_order, raw: r.raw_record, rawSha256: r.raw_sha256, data: r.data }));
    concepts.sort((a, b) => order.concepts.indexOf(a.id) - order.concepts.indexOf(b.id));
    const relations = (await query.query("SELECT data FROM private.source_relations WHERE bundle_id=$1 ORDER BY source_order", [id])).rows.map(r => r.data);
    const supplemental = (await query.query("SELECT data FROM private.source_supplements WHERE bundle_id=$1", [id])).rows[0]?.data;
    const frequency = (await query.query("SELECT data FROM private.source_frequency WHERE bundle_id=$1", [id])).rows[0]?.data;
    return bundleSchema.parse({ ...header.evidence as object, entries, meanings, concepts, relations, supplemental, frequency });
  }

  return {
    close: () => pool.end(),
    // The session lock covers verification and checkpoints. A crashed connection
    // releases it; a later command records the abandoned attempt before resume.
    async importBundle(options: { id: string; intention: unknown; load: () => Promise<EvidenceBundle>; limit?: number; beforeUnit?: (index: number) => Promise<void> }) {
      return guard(async () => {
        const { id } = options;
        const client = await pool.connect();
        let locked = false, attemptId: string | undefined;
        const started = Date.now();
        try {
          locked = (await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["wordwell:source:" + id])).rows[0].locked;
          if (!locked) throw new PrivateError("bundle_import_running");
          const initial = await seal(`source_bundles:${id}:payload`, { intention: options.intention });
          await client.query("INSERT INTO private.source_bundles(id,status,key_id,payload) VALUES($1,'loading',$2,$3) ON CONFLICT DO NOTHING", [id, key.id, initial]);
          await client.query("UPDATE private.source_import_attempts SET status='interrupted', error_code='owner_connection_ended' WHERE bundle_id=$1 AND status='loading'", [id]);
          attemptId = randomUUID();
          await client.query("INSERT INTO private.source_import_attempts(id,bundle_id,status) VALUES($1,$2,'loading')", [attemptId, id]);
          const bundle = bundleSchema.parse(await options.load());
          const evidenceSha256 = evidenceIdentity(bundle);
          let row = (await client.query("SELECT * FROM private.source_bundles WHERE id=$1", [id])).rows[0];
          const reused = row.status === "ready";
          if (row.evidence_sha256 && row.evidence_sha256 !== evidenceSha256) throw new PrivateError("bundle_evidence_changed_new_scope_required");
          const units: Unit[] = [];
          for (const a of bundle.artifacts) {
            const artifactId = fingerprint({ source: a.source, sha256: a.sha256, metadata: a.metadata });
            units.push({ sql: "INSERT INTO private.source_artifacts(id,source,sha256,byte_size,metadata) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", parameters: [artifactId, a.source, a.sha256, a.bytes, a.metadata], location: [artifactId, a.path] });
          }
          for (const e of bundle.entries) units.push({ sql: "INSERT INTO private.source_entries VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", parameters: [id, e.source, e.id, e.order, e.headword, e.pos, e.role, e.raw, e.rawSha256, e.locator, e.data] });
          for (const m of bundle.meanings) units.push({ sql: "INSERT INTO private.source_meanings VALUES($1,$2,$3,$4,$5,$6,$7)", parameters: [id, m.source, m.id, m.entryId, m.order, m.conceptId, { relations: m.relations, body: m.data }] });
          for (const c of bundle.concepts) units.push({ sql: "INSERT INTO private.source_concepts VALUES($1,$2,$3,$4,$5,$6)", parameters: [id, c.id, c.order, c.raw, c.rawSha256, c.data] });
          bundle.relations.forEach((r, i) => units.push({ sql: "INSERT INTO private.source_relations VALUES($1,$2,$3)", parameters: [id, i + 1, r] }));
          units.push({ sql: "INSERT INTO private.source_supplements VALUES($1,$2)", parameters: [id, bundle.supplemental] });
          units.push({ sql: "INSERT INTO private.source_frequency VALUES($1,$2,$3)", parameters: [id, bundle.frequency.order, bundle.frequency] });
          if (row.status !== "ready") {
            const header = { intention: options.intention, evidence: { scope: bundle.scope, artifacts: bundle.artifacts.map(a => ({ ...a, path: "" })), diagnostics: bundle.diagnostics, coverage: bundle.coverage, modelCalls: 0 },
              order: { entries: bundle.entries.map(e => `${e.source}:${e.id}`), meanings: bundle.meanings.map(m => `${m.source}:${m.id}`), concepts: bundle.concepts.map(c => c.id) } };
            await client.query("UPDATE private.source_bundles SET status='loading',unit_count=$2,evidence_sha256=$3,payload=$4 WHERE id=$1", [id, units.length, evidenceSha256, await seal(`source_bundles:${id}:payload`, header)]);
            const until = Math.min(units.length, row.checkpoint + (options.limit ?? units.length));
            for (let i = row.checkpoint; i < until; i++) {
              await client.query("BEGIN");
              try {
                await client.query(units[i].sql, units[i].parameters);
                if (units[i].location) await client.query("INSERT INTO private.source_locations VALUES($1,$2) ON CONFLICT DO NOTHING", units[i].location);
                await options.beforeUnit?.(i);
                await client.query("UPDATE private.source_bundles SET checkpoint=$2 WHERE id=$1", [id, i + 1]);
                await client.query("COMMIT");
              } catch (error) { await client.query("ROLLBACK"); throw error; }
            }
            if (until === units.length) {
              if (evidenceIdentity(await readBundle(id, client)) !== evidenceSha256) throw new PrivateError("persisted_evidence_mismatch");
              await client.query("UPDATE private.source_bundles SET status='ready' WHERE id=$1", [id]);
            }
          } else if (evidenceIdentity(await readBundle(id, client)) !== evidenceSha256) throw new PrivateError("persisted_evidence_mismatch");
          // Locations are deliberately outside immutable semantic identity.
          if (reused) for (const a of bundle.artifacts) await client.query("INSERT INTO private.source_locations VALUES($1,$2) ON CONFLICT DO NOTHING", [fingerprint({ source: a.source, sha256: a.sha256, metadata: a.metadata }), a.path]);
          row = (await client.query("SELECT status,checkpoint,unit_count FROM private.source_bundles WHERE id=$1", [id])).rows[0];
          await client.query("UPDATE private.source_import_attempts SET status=$2,elapsed_ms=$3 WHERE id=$1", [attemptId, row.status === "ready" ? "ready" : "interrupted", Date.now() - started]);
          return { bundleId: id, attemptId, status: row.status as string, checkpoint: row.checkpoint as number, unitCount: row.unit_count as number, reused,
            elapsedMs: Date.now() - started, modelCalls: 0, databaseBytes: Number((await client.query("SELECT pg_database_size(current_database()) AS bytes")).rows[0].bytes),
            sourceTableBytes: Number((await client.query("SELECT sum(pg_total_relation_size(c.oid)) AS bytes FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='private' AND c.relname=ANY($1)", [SOURCE_TABLES])).rows[0].bytes) };
        } catch (error) {
          if (attemptId) {
            const code = error instanceof PrivateError ? error.code : "source_import_failed";
            await client.query("UPDATE private.source_import_attempts SET status='failed',error_code=$2,elapsed_ms=$3 WHERE id=$1 AND status='loading'", [attemptId, code, Date.now() - started]).catch(() => {});
            await client.query("UPDATE private.source_bundles SET status='failed' WHERE id=$1 AND status!='ready'", [id]).catch(() => {});
          }
          throw error;
        } finally {
          let destroy = false;
          if (locked) {
            try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", ["wordwell:source:" + id]); }
            catch { destroy = true; }
          }
          client.release(destroy);
        }
      });
    },
    async readyBundle(id: string) {
      return guard(async () => {
        const row = (await pool.query("SELECT status,evidence_sha256 FROM private.source_bundles WHERE id=$1", [id])).rows[0];
        if (row?.status !== "ready") throw new PrivateError("selected_bundle_not_ready");
        const bundle = await readBundle(id);
        if (evidenceIdentity(bundle) !== row.evidence_sha256) throw new PrivateError("persisted_evidence_mismatch");
        return bundle;
      });
    },
    async assess(options: { bundleId: string; headword: string; configFingerprint: string; resolution: unknown; assessment: { disposition: "pass" | "exclude" | "unresolved" } & Record<string, unknown> }) {
      return guard(async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query("SELECT pg_advisory_xact_lock(hashtext('wordwell:intake-candidates'))");
          let candidateId: string | undefined, lessonId: string | undefined;
          for (const row of (await client.query("SELECT * FROM private.intake_candidates")).rows) {
            const material = await open(`intake_candidates:${row.id}:payload`, row, candidateSchema);
            if (material.headword === options.headword) { candidateId = row.id; lessonId = material.lessonId; break; }
          }
          if (!candidateId) {
            candidateId = randomUUID(); lessonId = randomUUID();
            await client.query("INSERT INTO private.intake_candidates VALUES($1,$2,$3)", [candidateId, key.id, await seal(`intake_candidates:${candidateId}:payload`, { headword: options.headword, lessonId })]);
          }
          await client.query("INSERT INTO private.intake_resolutions VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [options.bundleId, candidateId, key.id, await seal(`intake_resolutions:${options.bundleId}:${candidateId}:payload`, options.resolution)]);
          const id = fingerprint({ bundleId: options.bundleId, candidateId, configFingerprint: options.configFingerprint });
          await client.query("INSERT INTO private.intake_assessments(id,bundle_id,candidate_id,config_fingerprint,disposition,key_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [id, options.bundleId, candidateId, options.configFingerprint, options.assessment.disposition, key.id, await seal(`intake_assessments:${id}:payload`, options.assessment)]);
          await client.query("COMMIT");
          return { candidateId, lessonId, assessmentId: id, disposition: options.assessment.disposition };
        } catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      });
    },
    async explanation(bundleId: string, headword: string, configFingerprint: string) {
      return guard(async () => {
        for (const row of (await pool.query("SELECT * FROM private.intake_candidates")).rows) {
          const candidate = await open(`intake_candidates:${row.id}:payload`, row, candidateSchema);
          if (candidate.headword !== headword) continue;
          const assessment = (await pool.query("SELECT * FROM private.intake_assessments WHERE bundle_id=$1 AND candidate_id=$2 AND config_fingerprint=$3", [bundleId, row.id, configFingerprint])).rows[0];
          if (!assessment) throw new PrivateError("current_intake_assessment_missing");
          return { candidateId: row.id as string, ...candidate, bundleId, assessmentId: assessment.id as string,
            assessment: await open(`intake_assessments:${assessment.id}:payload`, assessment, json), modelCalls: 0 };
        }
        throw new PrivateError("candidate_not_found");
      });
    }
  };
}
export type SourceStore = Awaited<ReturnType<typeof createSourceStore>>;
