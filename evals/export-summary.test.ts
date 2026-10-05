// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportSummary } from "./export-summary.js";
import { buildSummary, summaryDigest } from "./summarize.js";

const summary = buildSummary({
  experimentId: "0d89389e-87c7-4ff5-8063-85c59d27c6d2", datasetId: "1516e404-73bf-4a5a-86f0-880dd3b9f993", datasetVersion: 1,
  configurationFingerprint: "a".repeat(64), pinnedModel: "typesafe/jev-1.13-20260917", purpose: "smoke", split: "all",
  summary: { cases: 5, requiredTrials: 15, validTrials: 15, invalidTrials: 0, failedTrials: 0, unresolvedTrials: 0, missingTrials: 0,
    trialWrongAccepts: 0, trialWrongRejects: 0, averagedWrongAccepts: 0, averagedWrongRejects: 0,
    casesAllThreeCorrect: 5, unstableCases: 0, passedCases: 5, goldenRequirementsPass: true },
  spend: { knownNanoUsd: 268_002, unresolvedRequests: 0, physicalRequests: 15 },
  startedAt: new Date("2026-10-05T02:53:42Z"), finishedAt: new Date("2026-10-05T02:54:18Z")
});
const sha = summaryDigest(summary);

type Call = { url: string; body: any };
function braintrust(options: { experimentDigest?: string; failInsert?: boolean } = {}) {
  const calls: Call[] = [];
  let failInsert = options.failInsert ?? false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input); const body = JSON.parse(String(init?.body));
    calls.push({ url, body });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer harmless-braintrust-key");
    if (url.endsWith("/v1/project")) return Response.json({ id: "proj-1", name: body.name });
    if (url.endsWith("/v1/experiment")) return Response.json({ id: "exp-1", name: body.name,
      metadata: { summarySha256: options.experimentDigest ?? body.metadata.summarySha256 } });
    if (url.endsWith("/v1/experiment/exp-1/insert")) {
      if (failInsert) { failInsert = false; throw new Error("connection reset after send"); }
      return Response.json({ row_ids: body.events.map((e: { id: string }) => e.id) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls };
}

let root: string;
let summaryPath: string;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "ww-export-test-"));
  summaryPath = resolve(root, "summary.json");
  await writeFile(summaryPath, JSON.stringify(summary));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const run = (fetch: typeof globalThis.fetch) =>
  exportSummary({ summaryPath, receiptsDir: resolve(root, "exports"), apiKey: "harmless-braintrust-key", fetch });

describe("aggregate-only Braintrust export", () => {
  it("uploads one summary row to a deterministic experiment and records the acknowledgement", async () => {
    const bt = braintrust();
    const receipt = await run(bt.fetch);
    expect(bt.calls.map(c => c.url)).toEqual([
      "https://api.braintrust.dev/v1/project", "https://api.braintrust.dev/v1/experiment", "https://api.braintrust.dev/v1/experiment/exp-1/insert"
    ]);
    expect(bt.calls[1].body).toMatchObject({ project_id: "proj-1", name: `appropriateness-${summary.experimentId}`, ensure_new: false });
    const events = bt.calls[2].body.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: summary.experimentId, scores: { trials_correct: 1, cases_passed: 1 },
      metadata: { summarySha256: sha, purpose: "smoke" } });
    expect(receipt).toMatchObject({ acknowledged: true, braintrustExperimentId: "exp-1", rowId: summary.experimentId, summarySha256: sha });
    expect(JSON.parse(await readFile(resolve(root, "exports", `${summary.experimentId}.json`), "utf8"))).toEqual(receipt);
  });

  it("retries a lost acknowledgement into the same experiment and row", async () => {
    const bt = braintrust({ failInsert: true });
    await expect(run(bt.fetch)).rejects.toThrow("upload_failed");
    expect(JSON.parse(await readFile(resolve(root, "exports", `${summary.experimentId}.json`), "utf8"))).toMatchObject({ acknowledged: false });
    const receipt = await run(bt.fetch);
    const inserts = bt.calls.filter(c => c.url.endsWith("/insert"));
    expect(inserts.map(c => c.body.events[0].id)).toEqual([summary.experimentId, summary.experimentId]);
    expect(receipt.acknowledged).toBe(true);
  });

  it("makes no request once acknowledged", async () => {
    await run(braintrust().fetch);
    const again = braintrust();
    await run(again.fetch);
    expect(again.calls).toHaveLength(0);
  });

  it("stops instead of overwriting when Braintrust holds a different artifact", async () => {
    const bt = braintrust({ experimentDigest: "b".repeat(64) });
    await expect(run(bt.fetch)).rejects.toThrow("export_conflict");
    expect(bt.calls.some(c => c.url.endsWith("/insert"))).toBe(false);
  });

  it("refuses a summary with private or extra fields before any request", async () => {
    await writeFile(summaryPath, JSON.stringify({ ...summary, note: "harmless-free-text" }));
    const bt = braintrust();
    await expect(run(bt.fetch)).rejects.toThrow("summary_invalid");
    expect(bt.calls).toHaveLength(0);
  });

  it("cannot reach private storage, keys, the database or a model client", async () => {
    const result = await build({ entryPoints: ["evals/export-summary.ts"], platform: "node", format: "esm",
      bundle: true, write: false, metafile: true, logLevel: "silent", packages: "external" });
    const inputs = Object.keys(result.metafile!.inputs);
    expect(inputs.some(path => /pipeline\/(storage|execution|stages)|private-appropriateness|authoring|keychain/.test(path))).toBe(false);
    const external = Object.values(result.metafile!.outputs).flatMap(o => o.imports.filter(i => i.external).map(i => i.path));
    expect([...new Set(external.filter(path => !path.startsWith("node:")))]).toEqual(["zod"]);
  });
});
