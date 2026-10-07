// #16's temporary local recovery check. No model adapter, plaintext dump,
// key file or hosted destination. The source database is never written.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Decrypter } from "age-encryption";
import pg from "pg";
import { loadFrozenDataset, manifestSchema } from "../evals/authoring/store.js";
import { createPrivateAppropriatenessReader } from "../evals/private-appropriateness.js";
import { checkout, openLocalPrivateStore } from "../evals/private-local.js";
import { startReportServer } from "../evals/private-report.js";
import { digest, PrivateError } from "../pipeline/storage/crypto.js";
import { loadKeychainIdentity } from "../pipeline/storage/keychain.js";
import { createPrivateStore } from "../pipeline/storage/postgres.js";
import { databaseConnection, inDatabase } from "../db/connections.mjs";

const SOURCE = databaseConnection("admin");
const name = `wordwell_restore_${randomBytes(6).toString("hex")}`;
const connection = (database: string) => inDatabase(SOURCE, database);
const check = (condition: boolean, code: string) => { if (!condition) throw new PrivateError(code); };

// Child diagnostics are suppressed because PostgreSQL errors can echo data.
function child(command: string, args: string[]) {
  const process = spawn(command, args, { cwd: checkout, stdio: ["pipe", "pipe", "ignore"] });
  const done = new Promise<void>((resolve, reject) => {
    process.once("error", () => reject(new PrivateError("restore_tool_failed")));
    process.once("close", code => code === 0 ? resolve() : reject(new PrivateError("restore_tool_failed")));
  });
  // Attach immediately, even when a pipe fails before this promise is awaited.
  void done.catch(() => {});
  return { process, done };
}

async function snapshot(pool: pg.Pool) {
  const { rows: tables } = await pool.query(`SELECT n.nspname AS schema, c.relname AS name,
    pg_get_userbyid(c.relowner) AS owner,
    ARRAY(SELECT a::text FROM unnest(COALESCE(c.relacl, acldefault('r', c.relowner))) a ORDER BY 1) AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'private') AND c.relkind = 'r' ORDER BY 1, 2`);
  const data = [];
  for (const table of tables) {
    const quote = (text: string) => '"' + text.replaceAll('"', '""') + '"';
    const { rows } = await pool.query(`SELECT count(*)::int AS count,
      md5(COALESCE(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), '')) AS digest
      FROM ${quote(table.schema)}.${quote(table.name)} t`);
    data.push({ ...table, ...rows[0] });
  }
  // A restore may omit an explicit owner-only ACL because it is the default.
  // Compare effective grants, not null versus an equivalent explicit array.
  const { rows: schemas } = await pool.query(`SELECT nspname, pg_get_userbyid(nspowner) AS owner,
    ARRAY(SELECT a::text FROM unnest(COALESCE(nspacl, acldefault('n', nspowner))) a ORDER BY 1) AS acl
    FROM pg_namespace WHERE nspname IN ('public', 'private') ORDER BY 1`);
  const { rows: defaults } = await pool.query(`SELECT pg_get_userbyid(defaclrole) AS owner, n.nspname,
    defaclobjtype, defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    ORDER BY 1, 2, 3`);
  return { schemas, defaults, data };
}

// HTTP response bodies stay in memory and are never printed or saved.
function get(url: string, cookie?: string) {
  return new Promise<{ status: number; cookie: string; bytes: number }>((resolve, reject) => {
    const req = request(url, { headers: cookie ? { cookie } : {} }, response => {
      let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; });
      response.on("end", () => resolve({ status: response.statusCode!,
        cookie: response.headers["set-cookie"]?.[0]?.split(";")[0] ?? "", bytes }));
    });
    req.on("error", () => reject(new PrivateError("restored_report_failed")));
    req.end();
  });
}

async function main() {
  process.umask(0o077);
  // This rehearsal is specifically for the approved local Docker database.
  const sourceUrl = new URL(SOURCE);
  check(["127.0.0.1", "localhost"].includes(sourceUrl.hostname) && sourceUrl.port === "54329" &&
    sourceUrl.pathname === "/wordwell_dev" && sourceUrl.username === "wordwell", "local_source_required");
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new PrivateError("network_forbidden"); };
  const local = await openLocalPrivateStore();
  const admin = new pg.Pool({ connectionString: connection("postgres") });
  const source = new pg.Pool({ connectionString: SOURCE });
  const restored = new pg.Pool({ connectionString: connection(name) });
  let directory: string | undefined;
  let created = false;
  let store: Awaited<ReturnType<typeof createPrivateStore>> | undefined;
  try {
    const before = await snapshot(source);
    directory = await mkdtemp(resolve(tmpdir(), "wordwell-restore-"));
    const dumpPath = resolve(directory, "snapshot.age");
    console.log(JSON.stringify({ temporaryDatabase: name, temporaryDirectory: directory }));
    const dump = child("docker", ["compose", "exec", "-T", "postgres", "pg_dump", "-U", "wordwell", "-d", "wordwell_dev", "-Fc"]);
    const age = child(resolve(homedir(), ".local/bin/age"), ["-r", local.keys.storageKey.recipient]);
    dump.process.stdin.end();
    try {
      await Promise.all([pipeline(dump.process.stdout, age.process.stdin),
        pipeline(age.process.stdout, createWriteStream(dumpPath, { flags: "wx", mode: 0o600 })), dump.done, age.done]);
    } finally { dump.process.kill(); age.process.kill(); }

    // Only the encrypted snapshot is on disk. Decryption uses a Keychain
    // identity in memory, then sends archive bytes to pg_restore's stdin.
    const decrypter = new Decrypter();
    decrypter.addIdentity(await loadKeychainIdentity(local.keys.storageKey));
    const archive = await decrypter.decrypt(await readFile(dumpPath));
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;
    const restore = child("docker", ["compose", "exec", "-T", "postgres", "pg_restore", "-U", "wordwell", "-d", name, "--exit-on-error", "--single-transaction"]);
    restore.process.stdout.resume();
    restore.process.stdin.on("error", () => {});
    restore.process.stdin.end(archive);
    try { await restore.done; } finally { archive.fill(0); restore.process.kill(); }
    check(JSON.stringify(await snapshot(restored)) === JSON.stringify(before), "restored_snapshot_mismatch");

    // pg_restore without --create does not restore database-level ACLs.
    await restored.query(`REVOKE CREATE, TEMPORARY ON DATABASE ${name} FROM PUBLIC`);
    const learnerPool = new pg.Pool({ connectionString: inDatabase(databaseConnection("learner"), name) });
    const learner = await learnerPool.connect();
    try {
      check((await learner.query("SELECT current_user = session_user AND current_user = 'wordwell_learner_login' AS actual_login")).rows[0].actual_login,
        "learner_login_required");
      await learner.query("SELECT count(*) FROM public.published_lessons");
      for (const table of ["experiments", "cases", "attempts", "trials", "requests", "case_scores"]) {
        let denied = false;
        try { await learner.query(`SELECT * FROM private.${table} LIMIT 0`); }
        catch (error) { denied = (error as { code?: string }).code === "42501"; }
        check(denied, "learner_isolation_failed");
      }
    } finally {
      learner.release();
      await learnerPool.end();
    }

    store = await createPrivateStore({ connectionString: inDatabase(databaseConnection("pipeline"), name), ...local.keys, crypto: local.crypto,
      beforeWrite: async () => { throw new PrivateError("restore_read_only"); } });
    const reader = createPrivateAppropriatenessReader(store);
    const original = createPrivateAppropriatenessReader(local.store);
    const experiments = await store.listExperiments();
    check(experiments.length > 0, "no_experiments");
    const artifacts = new Map<string, Awaited<ReturnType<typeof loadFrozenDataset>>>();
    let cases = 0;
    let savedScores = 0;
    let ephemeralDatasets = 0;
    let legacySmokeExperiments = 0;
    for (const experiment of experiments) {
      if (experiment.stage === "usefulness") {
        const saved = async (s: typeof store & {}) => ({ experiment: await s.readExperiment(experiment.id),
          cases: await s.readStageCases(experiment.id), expectations: [...await s.readStageExpectations(experiment.id)],
          attempts: await Promise.all((await s.listTrials(experiment.id)).map(t => s.readAttempt(t.attemptId))), spend: await s.spend(experiment.id) });
        check(digest(JSON.stringify(await saved(store))) === digest(JSON.stringify(await saved(local.store))), "restored_usefulness_mismatch");
        continue;
      }
      const info = await reader.describe(experiment.id);
      const results = await reader.caseResults(experiment.id);
      check(digest(JSON.stringify(results)) === digest(JSON.stringify(await original.caseResults(experiment.id))), "restored_results_mismatch");
      check(JSON.stringify(await reader.status(experiment.id)) === JSON.stringify(await original.status(experiment.id)), "restored_status_mismatch");
      savedScores += (await store.readCaseScores(experiment.id)).length;
      cases += results.length;
      if (info.purpose !== "evaluation") { ephemeralDatasets++; continue; }
      let frozen = artifacts.get(info.dataset.id);
      if (!frozen) {
        const path = resolve(checkout, "evals/datasets", `appropriateness-v${String(info.dataset.version).padStart(6, "0")}`);
        const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(path, "manifest.json"), "utf8")));
        // The first live smoke run predated the purpose field. Its temporary
        // dataset is gone, but its public inputs and saved replies remain.
        // Recognize only that known record, not arbitrary missing artifacts.
        if (experiment.id === "0d89389e-87c7-4ff5-8063-85c59d27c6d2" && manifest.id !== info.dataset.id) {
          const words = ["exuberant", "meticulous", "ephemeral", "clavicle", "serendipity"];
          check(results.length === words.length && new Set(results.map(r => r.headword)).size === words.length &&
            results.every(r => words.includes(r.headword) && r.expected === "clear"), "legacy_smoke_mismatch");
          legacySmokeExperiments++;
          continue;
        }
        check(manifest.id === info.dataset.id && manifest.version === info.dataset.version &&
          manifest.ciphertextSha256 === info.dataset.ciphertextSha256 &&
          JSON.stringify(manifest.key) === JSON.stringify(local.keys.datasetKey), "restored_artifact_mismatch");
        frozen = await loadFrozenDataset(path, manifest, local.crypto);
        artifacts.set(info.dataset.id, frozen);
      }
      const expected = frozen.cases.filter(c => info.split === "all" || c.split === info.split);
      check(expected.length === results.length && results.every(r => expected.some(c => c.id === r.caseId &&
        c.content.headword === r.headword && c.content.finding === r.expected && c.content.reason === r.reason && c.split === r.split)), "restored_cases_mismatch");
    }

    const report = await startReportServer({ store, runner: reader });
    try {
      check((await get(report.origin)).status === 403, "restored_session_failed");
      const session = await get(report.url);
      check(session.status === 303 && !!session.cookie, "restored_session_failed");
      const appropriateness = experiments.find(x => x.stage === "appropriateness");
      check(!!appropriateness, "no_appropriateness_report");
      for (let i = 0; i < 2; i++) check((await get(`${report.origin}/experiment/${appropriateness!.id}`, session.cookie)).status === 200, "restored_report_failed");
    } finally { await report.close(); }
    check(fetches === 0, "unexpected_network_request");
    check(JSON.stringify(await snapshot(source)) === JSON.stringify(before), "source_changed");
    check(JSON.stringify(await snapshot(restored)) === JSON.stringify(before), "restored_data_changed");
    console.log(JSON.stringify({ experiments: experiments.length, cases, savedScores, frozenArtifacts: artifacts.size,
      ephemeralSmokeOrAuditExperiments: ephemeralDatasets, migrations: before.data.find(t => t.name === "schema_migrations")?.count,
      legacySmokeExperiments, snapshotsMatch: true, learnerDeniedPrivateTables: 6, reportViews: 2, modelRequests: fetches }));
  } finally {
    // A failed close or deletion must not skip the remaining cleanup attempts.
    let failed = false;
    for (const cleanup of [
      () => store?.close(),
      () => local.store.close(),
      () => source.end(),
      () => restored.end(),
      () => created ? admin.query(`DROP DATABASE ${name} WITH (FORCE)`) : undefined,
      () => directory ? rm(directory, { recursive: true, force: true }) : undefined,
      () => admin.end()
    ]) {
      try { await cleanup(); } catch { failed = true; }
    }
    check(!failed, "restore_cleanup_failed");
    console.log("temporary_material_removed");
  }
}

main().catch(error => {
  console.error(error instanceof PrivateError ? error.code : "restore_rehearsal_failed");
  process.exitCode = 1;
});
