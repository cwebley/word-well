// Reassess the approved saved v4 experiment without calls or history changes.
// Capture encrypted evaluation history before the additive migration as well.
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { applyMigrations } from "../db/apply-migrations.mjs";
import { databaseConnection } from "../db/connections.mjs";
import { openLocalPrivateStore, summariesDir, checkout } from "../evals/private-local.js";
import { manifestSchema } from "../evals/authoring/store.js";
import { assessSavedPromotion } from "../pipeline/promotion.js";
import { digest, PrivateError } from "../pipeline/storage/crypto.js";

async function main() {
  const adminUrl = databaseConnection("admin");
  const url = new URL(adminUrl);
  if (url.pathname !== "/wordwell_dev" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new PrivateError("development_database_required");
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new PrivateError("network_forbidden"); };
  const admin = new pg.Pool({ connectionString: adminUrl });
  const tables = ["experiments", "cases", "trials", "attempts", "requests", "case_scores"];
  const columns = async () => (await admin.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='private' AND table_name=ANY($1)", [tables])).rows;
  let inheritedColumns: Awaited<ReturnType<typeof columns>>;
  async function history() {
    const counts = [];
    const currentColumns = await columns();
    for (const table of tables) {
      // Compare every column inherited at invocation, including every encrypted
      // byte. Ignore only columns this invocation's additive migrations create.
      const added = currentColumns.filter(c => c.table_name === table && !inheritedColumns.some(old => old.table_name === table && old.column_name === c.column_name)).map(c => c.column_name);
      const row = (await admin.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg((to_jsonb(t)-$1::text[])::text,E'\n' ORDER BY (to_jsonb(t)-$1::text[])::text),'')) AS digest FROM private.${table} t`, [added])).rows[0];
      counts.push({ table, ...row });
    }
    const artifacts = [];
    for (const name of (await readdir(summariesDir)).sort()) {
      if (!name.endsWith(".json")) continue;
      artifacts.push({ name, sha256: digest(await readFile(resolve(summariesDir, name))) });
    }
    return { counts, artifacts };
  }
  try {
    inheritedColumns = await columns();
    const before = await history();
    await applyMigrations(adminUrl);
    const local = await openLocalPrivateStore();
    try {
      const datasetDir = resolve(checkout, "evals/datasets/appropriateness-v000007");
      const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(datasetDir, "manifest.json"), "utf8")));
      const assessment = await assessSavedPromotion({ ...local, datasetDir, manifest, experimentId: "26c79436-6675-4181-bf41-df1cd5444da7" });
      const repeated = await assessSavedPromotion({ ...local, datasetDir, manifest, experimentId: assessment.experimentId });
      if (JSON.stringify(assessment) !== JSON.stringify(repeated) || JSON.stringify(before) !== JSON.stringify(await history())) throw new PrivateError("evaluation_history_changed");
      if (fetches !== 0) throw new PrivateError("unexpected_network_request");
      console.log(JSON.stringify({ assessment, evaluationHistoryPreserved: true, originalAggregateFilesPreserved: true,
        assessmentRepeatReusedIdentity: true, historyCounts: before.counts.map(({ table, count }) => ({ table, count })), networkRequests: fetches }));
    } finally { await local.store.close(); }
  } finally { await admin.end(); }
}
try { await main(); }
catch (error) { console.error(error instanceof PrivateError ? error.code : "saved_assessment_failed"); process.exitCode = 1; }
