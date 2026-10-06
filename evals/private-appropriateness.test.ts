// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONFIGURATIONS, createAppropriatenessStage } from "../pipeline/stages/appropriateness.js";
import { createSystemOneAdapter, SYSTEM_ONE_ROUTE } from "../pipeline/execution/system-one.js";
import { createPrivateStore } from "../pipeline/storage/postgres.js";
import { createReceiptLedger } from "../pipeline/storage/receipts.js";
import { fixturePool, jevReply, REPO, scriptedFetch, testDatabase, type ScriptedReply } from "../pipeline/testing/private-fixtures.js";
import { frozenDataset as frozenDatasetFixture } from "./private-fixtures.js";
import type { DatasetManifest } from "./authoring/store.js";
import { createPrivateAppropriatenessRunner, implementationIdentity, loadLocalConfig } from "./private-appropriateness.js";
import { parseSummary, summaryDigest } from "./summarize.js";
import { PrivateError } from "../pipeline/storage/crypto.js";

// Single-question fixtures: scripted replies answer one question.
const SINGLE_QUESTION = CONFIGURATIONS["v2"];

let database: Awaited<ReturnType<typeof testDatabase>>;
// Like the API suites, these skip without DATABASE_URL; `npm run test:private` requires it.
const withDatabase = describe.skipIf(!process.env.DATABASE_URL);
beforeAll(async () => { if (process.env.DATABASE_URL) database = await testDatabase(); });
afterAll(async () => { await database?.drop(); });

const config = loadLocalConfig(JSON.parse(await readFile(resolve(REPO, "config/private-appropriateness.json"), "utf8")));
const CAP = 1_000_000_000;

// Two harmless cases: a clear stand-in and a blocked stand-in. Neither is a golden label.
const frozenDataset = () => frozenDatasetFixture([{ headword: "exuberant", finding: "clear" }, { headword: "harmless-blocked-standin", finding: "blocked" }]);

async function stack(d: Awaited<ReturnType<typeof frozenDataset>>, script: ScriptedReply[], implementation?: Awaited<ReturnType<typeof implementationIdentity>>, localConfig = config) {
  const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto: d.f.crypto });
  const ledger = await createReceiptLedger({ directory: resolve(d.f.root, "ledger"), checkout: REPO });
  const remote = scriptedFetch(script);
  const runner = createPrivateAppropriatenessRunner({
    store, ledger,
    models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch }) },
    implementation: implementation ?? await implementationIdentity(), sleep: async () => {}
  });
  const create = (configuration = SINGLE_QUESTION, manifest: DatasetManifest = d.manifest) =>
    runner.create({ datasetDir: d.datasetDir, manifest, datasetCrypto: d.f.crypto, capNanoUsd: CAP, configuration, config: localConfig });
  return { store, ledger, remote, runner, create, close: () => store.close() };
}

const caseOrder = async (d: Awaited<ReturnType<typeof frozenDataset>>) => d.order;
const replies = (order: string[], byHeadword: Record<string, ScriptedReply[]>) => order.flatMap(headword => byHeadword[headword]);

withDatabase("private appropriateness runner", () => {
  it("runs three trials per case through the shared stage and scores every trial and the average", async () => {
    const d = await frozenDataset();
    const order = await caseOrder(d);
    const s = await stack(d, replies(order, {
      "exuberant": [jevReply("clear", 0.05), jevReply("clear", 0.1), jevReply("clear", 0.02)],
      // #12's example: the average rejects, but two trials accepted.
      "harmless-blocked-standin": [jevReply("clear", 0.49), jevReply("clear", 0.49), jevReply("blocked", 0.99)]
    }));
    try {
      const experimentId = await s.create();
      const report = await s.runner.run(experimentId);
      expect(report.stopped).toBeNull();
      expect(report.summary).toEqual({
        cases: 2, requiredTrials: 6, validTrials: 6, invalidTrials: 0, failedTrials: 0, unresolvedTrials: 0, missingTrials: 0,
        trialWrongAccepts: 2, trialWrongRejects: 0, averagedWrongAccepts: 0, averagedWrongRejects: 0,
        casesAllThreeCorrect: 1, unstableCases: 1, passedCases: 1, goldenRequirementsPass: false
      });
      expect(report.spend).toMatchObject({ knownNanoUsd: 6 * 17_304, unresolvedRequests: 0, physicalRequests: 6 });
      expect(s.remote.sent).toHaveLength(6);
      // Only the exact headword and fixed question leave the process.
      const stage = createAppropriatenessStage(SINGLE_QUESTION);
      expect(s.remote.sent.map(r => JSON.parse(r.body))).toEqual(order.flatMap(h => [0, 1, 2].map(() => stage.render({ headword: h }))));
      expect(s.remote.sent.some(r => /harmless-reason-marker|harmless-source-marker/.test(r.body))).toBe(false);

      // Inspecting saved work makes zero model calls and returns the same summary.
      expect(await s.runner.status(experimentId)).toEqual({ summary: report.summary, spend: report.spend, complete: true });
      expect(await s.runner.run(experimentId)).toEqual(report);
      expect(s.remote.sent).toHaveLength(6);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("stops on an invalid reply and resumes the remaining trials without replacing it", async () => {
    const d = await frozenDataset();
    const order = await caseOrder(d);
    const first = order[0];
    const expected = first === "exuberant" ? "clear" : "blocked";
    const p = expected === "clear" ? 0.05 : 0.95;
    const s = await stack(d, [jevReply(expected, p), { status: 200, body: "{truncated" }]);
    try {
      const experimentId = await s.create();
      expect((await s.runner.run(experimentId)).stopped).toEqual({ state: "invalid", code: "malformed_reply" });
      expect(s.remote.sent).toHaveLength(2);

      const resumed = await stack(d, [jevReply(expected, p), ...[0, 1, 2].map(() => jevReply(expected === "clear" ? "blocked" : "clear", 1 - p))]);
      const report = await resumed.runner.run(experimentId);
      expect(report.stopped).toBeNull();
      expect(report.summary).toMatchObject({ validTrials: 5, invalidTrials: 1, missingTrials: 0, casesAllThreeCorrect: 1, passedCases: 1, goldenRequirementsPass: false });
      expect(s.remote.sent.length + resumed.remote.sent.length).toBe(6);
      await resumed.close();
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("starts each new experiment with fresh trials and leaves earlier evidence unchanged", async () => {
    const d = await frozenDataset();
    const s = await stack(d, [...Array(6)].map(() => jevReply("clear", 0.1)).concat([...Array(6)].map(() => jevReply("blocked", 0.9))));
    try {
      const firstId = await s.create();
      const first = await s.runner.run(firstId);
      const secondId = await s.create();
      const second = await s.runner.run(secondId);
      expect(s.remote.sent).toHaveLength(12);
      const firstTrials = await s.store.listTrials(firstId);
      const secondTrials = await s.store.listTrials(secondId);
      expect(new Set([...firstTrials, ...secondTrials].map(t => t.attemptId)).size).toBe(12);
      expect(await s.runner.status(firstId)).toMatchObject({ summary: first.summary });
      expect(second.summary).not.toEqual(first.summary);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("evaluates a future configuration on the same frozen inputs under its own identity", async () => {
    const d = await frozenDataset();
    const future = { ...SINGLE_QUESTION, pinnedModel: "typesafe/jev-1.14-20270101" };
    // The provider still returns 1.13, which the future configuration rejects.
    const s = await stack(d, [...Array(6)].map(() => jevReply("clear", 0.1)).concat([jevReply("clear", 0.1)]));
    try {
      const incumbent = await s.create();
      await s.runner.run(incumbent);
      const candidate = await s.create(future);
      const report = await s.runner.run(candidate);
      expect(report.stopped).toEqual({ state: "invalid", code: "wrong_model" });
      const [a, b] = await Promise.all([s.store.readExperiment(incumbent), s.store.readExperiment(candidate)]);
      expect(a!.dataset).toEqual(b!.dataset);
      expect(a!.configurationFingerprint).not.toBe(b!.configurationFingerprint);
      // Both requests carry the same frozen headword.
      expect(s.remote.sent[6].body).toBe(s.remote.sent[0].body);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("refuses to resume under a changed implementation and makes no call", async () => {
    const d = await frozenDataset();
    const s = await stack(d, [{ status: 503, body: "busy" }, { status: 503, body: "busy" }, { status: 503, body: "busy" }]);
    try {
      const experimentId = await s.create();
      await s.runner.run(experimentId);
      const changed = await stack(d, [jevReply("clear", 0.1)], { ...(await implementationIdentity()), fingerprint: "c".repeat(64) });
      await expect(changed.runner.run(experimentId)).rejects.toThrow("implementation_changed");
      expect(changed.remote.sent).toHaveLength(0);
      await changed.close();
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("lets only one runner own an experiment at a time", async () => {
    const d = await frozenDataset();
    const quick = { ...config, execution: { ...config.execution, requestTimeoutSeconds: 1 } };
    const s = await stack(d, [{ hang: true }], undefined, quick);
    const other = await stack(d, []);
    try {
      const experimentId = await s.create();
      const running = s.runner.run(experimentId);
      await new Promise(done => setTimeout(done, 300));
      await expect(other.runner.run(experimentId)).rejects.toThrow("experiment_busy");
      expect(other.remote.sent).toHaveLength(0);
      expect((await running).stopped).toEqual({ state: "uncertain" });
    } finally { await s.close(); await other.close(); await d.f.cleanup(); }
  });

  it("stops before decryption or dispatch on a wrong dataset selection or an unavailable dataset key", async () => {
    const d = await frozenDataset();
    const s = await stack(d, []);
    try {
      await expect(s.create(SINGLE_QUESTION, { ...d.manifest, id: randomUUID() })).rejects.toThrow("dataset_selection_mismatch");
      d.f.setKeysAvailable(false);
      await expect(s.create()).rejects.toThrow("key_unavailable");
      expect(s.remote.sent).toHaveLength(0);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("keeps owner expectations and scores unreadable to stage execution, which holds only the storage key", async () => {
    const d = await frozenDataset();
    const s = await stack(d, [...Array(6)].map(() => jevReply("clear", 0.1)));
    const execution = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: d.f.storageKey, crypto: d.f.crypto });
    try {
      const experimentId = await s.create();
      await s.runner.run(experimentId);
      expect((await execution.readCases(experimentId)).map(c => c.input.headword).sort()).toEqual(["exuberant", "harmless-blocked-standin"]);
      await expect(execution.readExpectations(experimentId)).rejects.toThrow("dataset_key_required");
      await expect(execution.readCaseScores(experimentId)).rejects.toThrow("dataset_key_required");
    } finally { await execution.close(); await s.close(); await d.f.cleanup(); }
  });

  it("rejects a configuration whose retry delays do not match the retry limit", () => {
    expect(() => loadLocalConfig({ ...config, execution: { ...config.execution, retryDelaysSeconds: [] } })).toThrow();
  });

  it("reads per-case results from saved work with zero model calls", async () => {
    const d = await frozenDataset();
    const [first, second] = d.order;
    const expected = first === "exuberant" ? "clear" : "blocked";
    const p = expected === "clear" ? 0.05 : 0.95;
    const s = await stack(d, [jevReply(expected, p), jevReply(expected, p), { status: 200, body: "{truncated" }]);
    try {
      const experimentId = await s.create();
      await s.runner.run(experimentId);
      const results = await s.runner.caseResults(experimentId);
      expect(results.map(r => r.headword)).toEqual([first, second]);
      const disposition = expected === "clear" ? "accept" : "reject";
      expect(results[0]).toMatchObject({ expected, reason: `harmless-reason-marker-${expected}`, split: "development",
        trials: [
          { trialIndex: 1, state: "valid", code: null, blockedProbability: p, disposition, physicalRequests: 1 },
          { trialIndex: 2, state: "valid", code: null, blockedProbability: p, disposition, physicalRequests: 1 },
          { trialIndex: 3, state: "invalid", code: "malformed_reply", blockedProbability: null, disposition: null, physicalRequests: 1 }
        ],
        score: { pass: false, complete: true } });
      expect(results[1]).toMatchObject({ trials: [{ state: "missing" }, { state: "missing" }, { state: "missing" }], score: { complete: false } });
      expect(s.remote.sent).toHaveLength(3);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("finalizes an incomplete experiment into a saved aggregate summary and then refuses to run it", async () => {
    const d = await frozenDataset();
    const s = await stack(d, [{ status: 200, body: "{truncated" }]);
    try {
      const experimentId = await s.create();
      await s.runner.run(experimentId);
      const summariesDir = resolve(d.f.root, "summaries");
      const { path, sha256 } = await s.runner.finalize(experimentId, { summariesDir });
      const summary = parseSummary(JSON.parse(await readFile(path, "utf8")));
      expect(summaryDigest(summary)).toBe(sha256);
      expect(summary).toMatchObject({ experimentId, purpose: "evaluation", goldenRequirementsPass: false,
        counts: { cases: 2, requiredTrials: 6, invalidTrials: 1, missingTrials: 5 } });
      expect(JSON.stringify(summary)).not.toMatch(/exuberant|harmless-blocked-standin|harmless-reason-marker/);
      await expect(s.runner.run(experimentId)).rejects.toThrow("experiment_finalized");
      expect(await s.runner.finalize(experimentId, { summariesDir })).toEqual({ path, sha256 });
      expect(s.remote.sent).toHaveLength(1);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("runs only the selected split and records that membership", async () => {
    const d = await frozenDatasetFixture([
      { headword: "exuberant", finding: "clear" },
      { headword: "harmless-heldout-standin", finding: "clear", split: "held-out" }
    ]);
    const s = await stack(d, [...Array(3)].map(() => jevReply("clear", 0.1)));
    try {
      const experimentId = await s.runner.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto,
        capNanoUsd: CAP, configuration: SINGLE_QUESTION, config, split: "development" });
      const report = await s.runner.run(experimentId);
      expect(report.summary).toMatchObject({ cases: 1, requiredTrials: 3, validTrials: 3 });
      expect((await s.runner.caseResults(experimentId)).map(r => r.headword)).toEqual(["exuberant"]);
      expect(await s.runner.describe(experimentId)).toMatchObject({ split: "development" });
      expect(s.remote.sent.every(r => JSON.parse(r.body).state === "exuberant")).toBe(true);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("runs the slur-sense configuration end to end and catches a trial the main question alone would accept", async () => {
    const d = await frozenDataset();
    const byWord: Record<string, ScriptedReply[]> = {
      "exuberant": [0, 1, 2].map(() => jevReply("clear", 0.02, {}, 0.01)),
      "harmless-blocked-standin": [jevReply("clear", 0.47, {}, 0.83), jevReply("clear", 0.49, {}, 0.78), jevReply("blocked", 0.57, {}, 0.9)]
    };
    const s = await stack(d, replies(d.order, byWord));
    try {
      const experimentId = await s.create(CONFIGURATIONS["v3"]);
      const report = await s.runner.run(experimentId);
      expect(report.summary).toMatchObject({ validTrials: 6, trialWrongAccepts: 0, passedCases: 2, goldenRequirementsPass: true });
      expect(Object.keys(JSON.parse(s.remote.sent[0].body).questions)).toEqual(["appropriateness", "slur_sense"]);
      const standin = (await s.runner.caseResults(experimentId)).find(r => r.headword === "harmless-blocked-standin")!;
      expect(standin.trials.map(t => [t.blockedProbability, t.slurProbability, t.disposition])).toEqual([[0.47, 0.83, "reject"], [0.49, 0.78, "reject"], [0.57, 0.9, "reject"]]);
    } finally { await s.close(); await d.f.cleanup(); }
  });

  it("scores with the experiment's saved thresholds: slur 0.44 rejects under the 0.40 configuration", async () => {
    const d = await frozenDataset();
    const byWord: Record<string, ScriptedReply[]> = {
      "exuberant": [0, 1, 2].map(() => jevReply("clear", 0.02, {}, 0.05, 0.03)),
      "harmless-blocked-standin": [jevReply("clear", 0.37, {}, 0.44, 0.1), jevReply("clear", 0.35, {}, 0.49, 0.1), jevReply("clear", 0.4, {}, 0.52, 0.1)]
    };
    const s = await stack(d, replies(d.order, byWord));
    try {
      const experimentId = await s.create(CONFIGURATIONS["v4-vulgar-check"]);
      const report = await s.runner.run(experimentId);
      expect(report.summary).toMatchObject({ passedCases: 2, trialWrongAccepts: 0, goldenRequirementsPass: true });
      const standin = (await s.runner.caseResults(experimentId)).find(r => r.headword === "harmless-blocked-standin")!;
      expect(standin.trials.map(t => [t.slurProbability, t.vulgarProbability, t.disposition])).toEqual([[0.44, 0.1, "reject"], [0.49, 0.1, "reject"], [0.52, 0.1, "reject"]]);
      expect(Object.keys(JSON.parse(s.remote.sent[0].body).questions)).toEqual(["appropriateness", "slur_sense", "vulgar_sense"]);
    } finally { await s.close(); await d.f.cleanup(); }
  });
  it("stops evaluation dispatch when its experiment lock connection dies after intent", async () => {
    const d = await frozenDataset();
    const s = await stack(d, []);
    const admin = fixturePool(database.adminUrl);
    let killed = false;
    const ledger = { ...s.ledger, append: async (...args: Parameters<typeof s.ledger.append>) => {
      await s.ledger.append(...args);
      if (args[0].type === "dispatch_intent" && !killed) {
        killed = true;
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=hashtext('wordwell:experiment')::oid AND objid=hashtext($1)::oid", [args[0].experimentId]);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } };
    const runner = createPrivateAppropriatenessRunner({ store: s.store, ledger,
      models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: s.remote.fetch }) }, implementation: await implementationIdentity() });
    try {
      const id = await s.create();
      await expect(runner.run(id)).rejects.toThrow("storage_unavailable");
      expect(s.remote.sent).toHaveLength(0);
      expect((await s.ledger.read()).map(r => r.type)).toEqual(["dispatch_intent", "dispatch_cancelled"]);
      expect(await s.store.spend(id)).toMatchObject({ physicalRequests: 0, outstandingNanoUsd: 0 });
    } finally { await admin.end(); await s.close(); await d.f.cleanup(); }
  });
  it("cannot freeze or publish an aggregate through a dead experiment lock session", async () => {
    const d = await frozenDataset();
    const s = await stack(d, []);
    const admin = fixturePool(database.adminUrl);
    const store = { ...s.store, finalizeExperiment: async (...args: Parameters<typeof s.store.finalizeExperiment>) => {
      await admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=hashtext('wordwell:experiment')::oid AND objid=hashtext($1)::oid", [args[0]]);
      await new Promise(resolve => setTimeout(resolve, 20));
      return s.store.finalizeExperiment(...args);
    } };
    const runner = createPrivateAppropriatenessRunner({ store, ledger: s.ledger,
      models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: s.remote.fetch }) }, implementation: await implementationIdentity() });
    try {
      const id = await s.create();
      const summariesDir = resolve(d.f.root, "summaries");
      await expect(runner.finalize(id, { summariesDir })).rejects.toThrow("storage_unavailable");
      expect((await s.store.readExperiment(id))?.finalizedAt).toBeNull();
      await expect(readFile(resolve(summariesDir, `${id}.json`))).rejects.toMatchObject({ code: "ENOENT" });
      const finalized = await s.runner.finalize(id, { summariesDir });
      expect(summaryDigest(parseSummary(JSON.parse(await readFile(finalized.path, "utf8"))))).toBe(finalized.sha256);
      expect(s.remote.sent).toHaveLength(0);
    } finally { await admin.end(); await s.close(); await d.f.cleanup(); }
  });
  it("cannot mark a trial valid after lock loss during result encryption, and resumes from the saved raw reply", async () => {
    const d = await frozenDataset();
    const s = await stack(d, d.order.flatMap(h => Array.from({ length: 3 }, () => jevReply(h === "exuberant" ? "clear" : "blocked", h === "exuberant" ? 0.1 : 0.9))));
    const admin = fixturePool(database.adminUrl);
    let killed = false;
    const crypto = { ...d.f.crypto, encrypt: async (...args: Parameters<typeof d.f.crypto.encrypt>) => {
      const bytes = await d.f.crypto.encrypt(...args);
      if (!killed && args[1].startsWith("attempts:") && args[1].endsWith(":result")) {
        killed = true;
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=hashtext('wordwell:experiment')::oid");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return bytes;
    } };
    const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto });
    const runner = createPrivateAppropriatenessRunner({ store, ledger: s.ledger, models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: s.remote.fetch }) }, implementation: await implementationIdentity() });
    try {
      const id = await s.create();
      await expect(runner.run(id)).rejects.toThrow("storage_unavailable");
      const firstTrial = (await s.store.listTrials(id))[0];
      expect((await s.store.readAttempt(firstTrial.attemptId))).toMatchObject({ status: "pending", result: null });
      expect((await s.runner.status(id)).summary.validTrials).toBe(0);
      expect(s.remote.sent).toHaveLength(1);
      expect((await s.runner.run(id)).summary).toMatchObject({ validTrials: 6, goldenRequirementsPass: true });
      expect(s.remote.sent).toHaveLength(6);
    } finally { await store.close(); await admin.end(); await s.close(); await d.f.cleanup(); }
  });
  it("recreates the exact frozen aggregate after file failure and a later known charge", async () => {
    const d = await frozenDataset();
    const s = await stack(d, [{ throws: "harmless-network-marker" }]);
    const runner = createPrivateAppropriatenessRunner({ store: s.store, ledger: s.ledger, models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: s.remote.fetch }) },
      implementation: await implementationIdentity(), writeSummary: async () => { throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await s.create();
      await s.runner.run(id);
      const summariesDir = resolve(d.f.root, "summaries");
      await expect(runner.finalize(id, { summariesDir })).rejects.toThrow("storage_unavailable");
      const experiment = (await s.store.readExperiment(id))!;
      const frozen = parseSummary(experiment.frozenSummary);
      expect(frozen.cost).toMatchObject({ knownUsd: 0, unresolvedRequests: 1 });
      await expect(readFile(resolve(summariesDir, `${id}.json`))).rejects.toMatchObject({ code: "ENOENT" });
      const trial = (await s.store.listTrials(id))[0];
      const request = (await s.store.readAttempt(trial.attemptId))!.requests[0];
      await s.store.reconcileRequestAccounting(request.id, { chargeNanoUsd: 17_304, generationId: "gen-harmless-late", inputTokens: 412, outputTokens: 20 });
      expect(await s.store.spend(id)).toMatchObject({ knownNanoUsd: 17_304, unresolvedRequests: 0 });
      const restored = await s.runner.finalize(id, { summariesDir });
      expect(restored.sha256).toBe(experiment.summarySha256);
      expect(parseSummary(JSON.parse(await readFile(restored.path, "utf8")))).toEqual(frozen);
      expect(s.remote.sent).toHaveLength(1);
    } finally { await s.close(); await d.f.cleanup(); }
  });
  it("cannot overwrite finalized case scores after losing ownership during partial-score encryption", async () => {
    const d = await frozenDataset();
    const s = await stack(d, d.order.flatMap(h => Array.from({ length: 3 }, () => jevReply(h === "exuberant" ? "clear" : "blocked", h === "exuberant" ? 0.1 : 0.9))));
    const admin = fixturePool(database.adminUrl);
    let blocked!: () => void, releaseScore!: () => void;
    const waiting = new Promise<void>(resolve => { blocked = resolve; });
    const proceed = new Promise<void>(resolve => { releaseScore = resolve; });
    let first = true;
    const crypto = { ...d.f.crypto, encrypt: async (...args: Parameters<typeof d.f.crypto.encrypt>) => {
      const bytes = await d.f.crypto.encrypt(...args);
      if (first && args[1].startsWith("case_scores:")) {
        first = false;
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=hashtext('wordwell:experiment')::oid");
        await new Promise(resolve => setTimeout(resolve, 20));
        blocked(); await proceed;
      }
      return bytes;
    } };
    const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto });
    const runner = createPrivateAppropriatenessRunner({ store, ledger: s.ledger, models: { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: s.remote.fetch }) }, implementation: await implementationIdentity() });
    try {
      const id = await s.create();
      const stale = runner.run(id).catch(error => error);
      await waiting;
      expect((await s.runner.run(id)).summary.validTrials).toBe(6);
      await s.runner.finalize(id, { summariesDir: resolve(d.f.root, "summaries") });
      const scores = await s.store.readCaseScores(id);
      releaseScore();
      expect(await stale).toMatchObject({ code: "storage_unavailable" });
      expect(await s.store.readCaseScores(id)).toEqual(scores);
      expect(s.remote.sent).toHaveLength(6);
    } finally { releaseScore(); await store.close(); await admin.end(); await s.close(); await d.f.cleanup(); }
  });
});
