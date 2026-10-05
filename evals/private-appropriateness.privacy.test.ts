// @vitest-environment node
// Harmless marker tests for #15: private text must not reach SQL metadata,
// receipts, errors, console output, files or any destination but the model.
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIGURATIONS } from "../pipeline/stages/appropriateness.js";
import { createSystemOneAdapter, SYSTEM_ONE_ENDPOINT, SYSTEM_ONE_ROUTE } from "../pipeline/execution/system-one.js";
import { PrivateError } from "../pipeline/storage/crypto.js";
import { createPrivateStore } from "../pipeline/storage/postgres.js";
import { createReceiptLedger } from "../pipeline/storage/receipts.js";
import { jevReply, REPO, scriptedFetch, testDatabase } from "../pipeline/testing/private-fixtures.js";
import { createPrivateAppropriatenessRunner, implementationIdentity, loadLocalConfig } from "./private-appropriateness.js";
import { frozenDataset } from "./private-fixtures.js";

// Single-question fixtures: scripted replies answer one question.
const SINGLE_QUESTION = CONFIGURATIONS["v2"];

const HEADWORD = "harmless-headword-marker-q7";
const REASON = "harmless-reason-marker-q7";
const PROVENANCE = "harmless-source-marker-q7";
const ERROR = "harmless-error-marker-q7";
const PRIVATE = [HEADWORD, REASON, PROVENANCE, ERROR];

let database: Awaited<ReturnType<typeof testDatabase>>;
// Like the API suites, these skip without DATABASE_URL; `npm run test:private` requires it.
const withDatabase = describe.skipIf(!process.env.DATABASE_URL);
beforeAll(async () => { if (process.env.DATABASE_URL) database = await testDatabase(); });
afterAll(async () => { await database?.drop(); });

async function plaintextColumns(url: string): Promise<string> {
  const pool = new pg.Pool({ connectionString: url });
  try {
    const { rows: columns } = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'private' AND data_type <> 'bytea' ORDER BY table_name, ordinal_position`);
    const tables = [...new Set(columns.map(c => c.table_name as string))];
    let text = "";
    for (const table of tables) {
      const names = columns.filter(c => c.table_name === table).map(c => `"${c.column_name}"::text`).join(", ");
      const { rows } = await pool.query(`SELECT ${names} FROM private."${table}"`);
      text += JSON.stringify(rows);
    }
    const { rows: ciphertext } = await pool.query(
      `SELECT encode(payload, 'escape') AS t FROM private.experiments UNION ALL
       SELECT encode(input_payload, 'escape') || encode(expectation_payload, 'escape') FROM private.cases UNION ALL
       SELECT encode(input_payload, 'escape') || COALESCE(encode(result_payload, 'escape'), '') FROM private.attempts UNION ALL
       SELECT COALESCE(encode(response_payload, 'escape'), '') FROM private.requests UNION ALL
       SELECT encode(payload, 'escape') FROM private.case_scores`);
    return text + JSON.stringify(ciphertext);
  } finally { await pool.end(); }
}

async function filesUnder(root: string): Promise<{ path: string; text: string }[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(entries.filter(e => e.isFile()).map(async e => {
    const path = resolve(e.parentPath, e.name);
    return { path, text: (await readFile(path)).toString("latin1") };
  }));
}

withDatabase("private appropriateness privacy", () => {
  it("keeps marker text out of SQL metadata, receipts, console, errors and files, and sends only the headword", async () => {
    const d = await frozenDataset([{ headword: HEADWORD, finding: "blocked", overrides: { reason: REASON, provenance: PROVENANCE } }]);
    const before = execFileSync("git", ["status", "--porcelain"], { cwd: REPO }).toString();
    const output: string[] = [];
    const spies = (["log", "error", "warn", "info", "debug"] as const).map(name =>
      vi.spyOn(console, name).mockImplementation((...args) => { output.push(args.map(String).join(" ")); }));
    try {
      let failWrites = true;
      const store = await createPrivateStore({ connectionString: database.url, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto: d.f.crypto,
        beforeWrite: async operation => { if (failWrites && operation === "record_outcome") throw new Error(`${ERROR} ${HEADWORD}`); } });
      const ledger = await createReceiptLedger({ directory: resolve(d.f.root, "ledger"), checkout: REPO });
      const remote = scriptedFetch([
        { status: 503, body: JSON.stringify({ error: { code: 503, message: `${ERROR} upstream echoed ${HEADWORD}` } }) },
        { status: 200, body: `${ERROR} not json ${HEADWORD}` },
        jevReply("blocked", 0.9)
      ]);
      const config = loadLocalConfig(JSON.parse(await readFile(resolve(REPO, "config/private-appropriateness.json"), "utf8")));
      const runner = createPrivateAppropriatenessRunner({ store, ledger, implementation: await implementationIdentity(), sleep: async () => {},
        models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch }) } });
      const experimentId = await runner.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto,
        capNanoUsd: 1_000_000_000, configuration: SINGLE_QUESTION, config });

      // A storage failure whose driver error carries markers surfaces only a code.
      const blocked = await runner.run(experimentId);
      expect(blocked.stopped).toEqual({ state: "paused", code: "storage_unavailable" });
      failWrites = false;
      const lost = await runner.run(experimentId);
      expect(lost.stopped).toEqual({ state: "response_lost" });
      const invalid = await runner.run(experimentId);
      expect(invalid.stopped).toEqual({ state: "invalid", code: "malformed_reply" });
      const done = await runner.run(experimentId);
      expect(done.summary).toMatchObject({ failedTrials: 1, invalidTrials: 1, validTrials: 1 });
      const report = JSON.stringify([blocked, lost, invalid, done, await runner.status(experimentId)]);

      const errors: string[] = [];
      for (const attempt of [() => runner.run("00000000-0000-4000-8000-000000000000"), () => store.readAttempt("not-a-uuid")]) {
        try { await attempt(); } catch (error) {
          expect(error).toBeInstanceOf(PrivateError);
          errors.push(String(error), (error as Error).stack ?? "");
        }
      }
      expect(errors.length).toBeGreaterThan(0);
      await store.close();

      // Destinations: only the pinned route, and only the headword as case data.
      expect(new Set(remote.sent.map(r => r.url))).toEqual(new Set([SYSTEM_ONE_ENDPOINT]));
      for (const sent of remote.sent) {
        expect(JSON.parse(sent.body).state).toBe(HEADWORD);
        expect(sent.body.includes(REASON) || sent.body.includes(PROVENANCE)).toBe(false);
      }

      const sql = await plaintextColumns(database.url);
      const receipts = await readFile(resolve(d.f.root, "ledger/receipts.jsonl"), "utf8");
      const files = (await filesUnder(d.f.root)).map(f => f.text).join("\n");
      const surfaces = { sql, receipts, report, errors: errors.join("\n"), console: output.join("\n"), files };
      for (const [surface, text] of Object.entries(surfaces))
        for (const marker of PRIVATE) expect(text.includes(marker), `${marker} in ${surface}`).toBe(false);
      // Three physical requests, each with a dispatch intent and an outcome.
      expect(remote.sent).toHaveLength(3);
      expect(receipts.split("\n").filter(Boolean)).toHaveLength(6);
      expect(execFileSync("git", ["status", "--porcelain"], { cwd: REPO }).toString()).toBe(before);
    } finally {
      spies.forEach(spy => spy.mockRestore());
      await d.f.cleanup();
    }
  });

  it("denies the learner role any access to private records", async () => {
    const pool = new pg.Pool({ connectionString: database.url });
    const client = await pool.connect();
    try {
      await client.query("SET ROLE wordwell_learner");
      await client.query("SELECT count(*) FROM public.published_lessons");
      for (const table of ["experiments", "cases", "attempts", "trials", "requests", "case_scores"])
        await expect(client.query(`SELECT * FROM private.${table}`)).rejects.toMatchObject({ code: "42501" });
    } finally { await client.query("RESET ROLE"); client.release(); await pool.end(); }
  });

  it("keeps hosted evaluation, tracing, telemetry and the plaintext usefulness client out of the private import graph", async () => {
    const result = await build({ entryPoints: ["evals/private-appropriateness.ts", "evals/private-appropriateness-cli.ts", "evals/private-report.ts"], outdir: "unused", platform: "node", format: "esm",
      bundle: true, write: false, metafile: true, logLevel: "silent", packages: "external" });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some(path => /braintrust|opentelemetry|@ai-sdk|openai|sentry|posthog|pipeline\/execution\/jev\.ts|evals\/usefulness/.test(path))).toBe(false);
    const external = Object.values(result.metafile!.outputs).flatMap(o => o.imports.filter(i => i.external).map(i => i.path));
    expect([...new Set(external.filter(path => !path.startsWith("node:")))].sort()).toEqual(["age-encryption", "pg", "zod"]);
  });
});
