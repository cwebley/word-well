// @vitest-environment node
import { readdir, readFile } from "node:fs/promises";
import { request } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CONFIGURATIONS } from "../pipeline/stages/appropriateness.js";
import { createSystemOneAdapter, SYSTEM_ONE_ROUTE } from "../pipeline/execution/system-one.js";
import { createPrivateStore } from "../pipeline/storage/postgres.js";
import { createReceiptLedger } from "../pipeline/storage/receipts.js";
import { digest } from "../pipeline/storage/crypto.js";
import { jevReply, REPO, scriptedFetch, testDatabase } from "../pipeline/testing/private-fixtures.js";
import { createPrivateAppropriatenessReader, createPrivateAppropriatenessRunner, implementationIdentity, loadLocalConfig } from "./private-appropriateness.js";
import { frozenDataset } from "./private-fixtures.js";
import { startReportServer } from "./private-report.js";

// Single-question fixtures: scripted replies answer one question.
const SINGLE_QUESTION = CONFIGURATIONS["v2"];
const RAW_MARKER = "harmless-report-reply-marker-q7";
const ERROR_MARKER = "harmless-report-error-marker-q7";

async function filesUnder(root: string) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
    const path = resolve(entry.parentPath, entry.name);
    const bytes = await readFile(path);
    return { path, digest: digest(bytes), text: bytes.toString("latin1") };
  }));
}

const withDatabase = describe.skipIf(!process.env.DATABASE_URL);
let database: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { if (process.env.DATABASE_URL) database = await testDatabase(); });
afterAll(async () => { await database?.drop(); });

// Raw HTTP so the Host header and cookies are exactly what the test sends.
function get(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((done, fail) => {
    const req = request(url, { headers }, response => {
      let body = "";
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => done({ status: response.statusCode!, headers: response.headers, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

withDatabase("private appropriateness report", () => {
  it("shows every word, trial, average and raw reply to the session holder only, with zero model calls", async () => {
    const d = await frozenDataset([
      { headword: "exuberant", finding: "clear", overrides: { reason: "<b>harmless-reason-markup</b>" } },
      { headword: "harmless-blocked-standin", finding: "blocked" }
    ]);
    const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto: d.f.crypto });
    const ledger = await createReceiptLedger({ directory: resolve(d.f.root, "ledger"), checkout: REPO });
    const byWord: Record<string, ReturnType<typeof jevReply>[]> = {
      "exuberant": [jevReply("clear", 0.05, { provider: RAW_MARKER }), jevReply("clear", 0.1), jevReply("clear", 0.02)],
      "harmless-blocked-standin": [jevReply("clear", 0.49), jevReply("clear", 0.49), jevReply("blocked", 0.99)]
    };
    const remote = scriptedFetch([...d.order.flatMap(w => byWord[w]), ...d.order.flatMap(w => byWord[w].map(() => jevReply("blocked", 0.9)))]);
    const config = loadLocalConfig(JSON.parse(await readFile(resolve(REPO, "config/private-appropriateness.json"), "utf8")));
    const runner = createPrivateAppropriatenessRunner({ store, ledger, implementation: await implementationIdentity(), sleep: async () => {},
      models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch }) } });
    const create = () => runner.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto, capNanoUsd: 1_000_000_000,
      configuration: SINGLE_QUESTION, config });
    const first = await create(); await runner.run(first);
    const second = await create(); await runner.run(second);
    const calls = remote.sent.length;
    const filesBefore = await filesUnder(d.f.root);
    const output: string[] = [];
    const spies = (["log", "error", "warn", "info", "debug"] as const).map(name =>
      vi.spyOn(console, name).mockImplementation((...args) => { output.push(args.map(String).join(" ")); }));
    const reader = createPrivateAppropriatenessReader(store);
    const server = await startReportServer({ store, runner: reader });
    try {
      const host = new URL(server.origin).host;
      expect((await get(server.origin + "/", { host })).status).toBe(403);
      const opened = await get(server.url, { host });
      expect(opened.status).toBe(303);
      expect(String(opened.headers["set-cookie"])).toContain("HttpOnly; SameSite=Strict");
      const cookie = String(opened.headers["set-cookie"]).split(";")[0];
      const page = (path: string) => get(server.origin + path, { host, cookie });

      const index = await page("/");
      expect(index.status).toBe(200);
      expect(index.headers["cache-control"]).toBe("no-store, max-age=0");
      expect(index.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(index.body).toContain(first);
      expect(index.body).toContain(second);

      const detail = await page(`/experiment/${first}`);
      expect(detail.body).toContain("exuberant");
      expect(detail.body).toContain("harmless-blocked-standin");
      expect(detail.body).toContain(RAW_MARKER);
      expect(detail.body).toContain("&lt;b&gt;harmless-reason-markup&lt;/b&gt;");
      expect(detail.body).not.toContain("<b>harmless-reason-markup</b>");
      expect(detail.body).toContain("0.49");
      expect(detail.body).toContain("wrong accept");
      expect(detail.body).toContain("typesafe/jev-1.13-20260917");
      expect(detail.body).toContain("<strong>v2</strong>");
      expect(detail.body).not.toMatch(/<script|https?:\/\/(?!127\.0\.0\.1)/i);

      const mistakes = await page(`/experiment/${first}?filter=mistakes`);
      expect(mistakes.body).toContain("harmless-blocked-standin");
      expect(mistakes.body).not.toContain(">exuberant<");

      const compare = await page(`/compare/${first}/${second}`);
      expect(compare.status).toBe(200);
      expect(compare.body).toContain("exuberant");

      expect((await page("/experiment/not-a-uuid")).status).toBe(404);
      expect((await get(server.origin + "/", { host: "evil.example", cookie })).status).toBe(403);
      expect((await get(server.origin + "/", { host, cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
      expect((await page(`/experiment/${first}`)).status).toBe(200);

      // A private diagnostic must not escape in an HTTP error or console log.
      const failure = vi.spyOn(reader, "caseResults").mockRejectedValueOnce(new Error(ERROR_MARKER));
      try {
        const failed = await page(`/experiment/${first}`);
        expect(failed.status).toBe(503);
        expect(failed.body).toBe("report_failed");
        expect(failed.headers["cache-control"]).toBe("no-store, max-age=0");
      } finally { failure.mockRestore(); }

      // Report requests must not create files or alter encrypted artifacts or
      // the ledger in the controlled private workspace. No browser is used.
      const filesAfter = await filesUnder(d.f.root);
      expect(filesAfter.map(({ path, digest }) => ({ path, digest })))
        .toEqual(filesBefore.map(({ path, digest }) => ({ path, digest })));
      const outsidePage = output.join("\n") + filesAfter.map(file => file.path + file.text).join("\n");
      for (const marker of ["harmless-blocked-standin", "harmless-reason-markup", RAW_MARKER, ERROR_MARKER])
        expect(outsidePage.includes(marker), `marker outside report: ${marker}`).toBe(false);
      expect(remote.sent).toHaveLength(calls);
    } finally {
      spies.forEach(spy => spy.mockRestore());
      await server.close(); await store.close(); await d.f.cleanup();
    }
  });
});
