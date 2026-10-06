// @vitest-environment node
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONFIGURATIONS, createAppropriatenessStage } from "../stages/appropriateness.js";
import { createPrivateStore } from "../storage/postgres.js";
import { createReceiptLedger } from "../storage/receipts.js";
import { harmlessKeys, jevReply, privateTempDir, REPO, scriptedFetch, testDatabase, type ScriptedReply } from "../testing/private-fixtures.js";
import { createStageExecutor, type ExecutionSettings } from "./executor.js";
import { createSystemOneAdapter, SYSTEM_ONE_ENDPOINT } from "./system-one.js";

// Single-question fixtures: scripted replies answer one question.
const SINGLE_QUESTION = CONFIGURATIONS["v2"];

const stage = createAppropriatenessStage(SINGLE_QUESTION);
const settings: ExecutionSettings = {
  requestTimeoutMs: 600_000, maxTransportRetries: 2, retryDelaysMs: [2_000, 8_000], maxRetryWaitMs: 60_000,
  reservationNanoUsd: 1_344_000
};

let database: Awaited<ReturnType<typeof testDatabase>>;
// Like the API suites, these skip without DATABASE_URL; `npm run test:private` requires it.
const withDatabase = describe.skipIf(!process.env.DATABASE_URL);
beforeAll(async () => { if (process.env.DATABASE_URL) database = await testDatabase(); });
afterAll(async () => { await database?.drop(); });

// Builds a fresh process-like stack against the shared database and ledger.
async function harness(script: ScriptedReply[], options: {
  keys?: Awaited<ReturnType<typeof harmlessKeys>>; dir?: string; capNanoUsd?: number;
  beforeWrite?: (operation: string) => Promise<void>; beforeAppend?: (type: string) => Promise<void>;
} = {}) {
  const keys = options.keys ?? await harmlessKeys();
  const temp = options.dir ? null : await privateTempDir();
  const dir = options.dir ?? temp!.root;
  const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto, beforeWrite: options.beforeWrite });
  const ledger = await createReceiptLedger({ directory: dir + "/ledger", checkout: REPO, beforeAppend: options.beforeAppend });
  const remote = scriptedFetch(script);
  const sleeps: number[] = [];
  let clock = Date.parse("2026-10-04T12:00:00Z");
  const executor = createStageExecutor({
    store, ledger, settings,
    model: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch }),
    now: () => new Date(clock),
    sleep: async ms => { sleeps.push(ms); clock += ms; }
  });
  const experimentId = randomUUID();
  await store.createExperiment({
    id: experimentId, stage: "appropriateness",
    dataset: { id: randomUUID(), version: 1, ciphertextSha256: "a".repeat(64) },
    configurationFingerprint: stage.fingerprint, implementationFingerprint: "b".repeat(64),
    capNanoUsd: options.capNanoUsd ?? 1_000_000_000, material: { harmless: true }
  });
  const run = (attemptId = randomUUID(), headword = "exuberant") =>
    executor.execute({ experimentId, attemptId, stage, input: { headword } });
  return { keys, dir, store, ledger, remote, sleeps, executor, experimentId, run,
    close: async () => { await store.close(); await temp?.cleanup(); } };
}

withDatabase("shared stage executor", () => {
  it("dispatches once, validates, saves the raw reply and returns the saved outcome on resume", async () => {
    const h = await harness([jevReply("clear", 0.07)]);
    try {
      const attemptId = randomUUID();
      const outcome = await h.run(attemptId);
      expect(outcome).toMatchObject({ attemptId, state: "valid", result: { blockedProbability: 0.07, disposition: "accept" } });
      expect(h.remote.sent).toHaveLength(1);
      expect(h.remote.sent[0].url).toBe(SYSTEM_ONE_ENDPOINT);
      expect(JSON.parse(h.remote.sent[0].body)).toEqual(stage.render({ headword: "exuberant" }));

      const saved = await h.store.readAttempt(attemptId);
      expect(saved).toMatchObject({ status: "valid", requests: [{ sequence: 1, status: "responded", chargeStatus: "known", chargeNanoUsd: 17_304, httpStatus: 200 }] });
      const response = saved!.requests[0].response;
      expect(response?.kind === "response" && JSON.parse(response.body).usage.cost).toBe(0.000017304);
      expect((await h.ledger.read()).map(e => e.type)).toEqual(["dispatch_intent", "request_outcome"]);

      expect(await h.run(attemptId)).toEqual(outcome);
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });

  it("retries explicit transient failures within the limit, honoring the longer of Retry-After and the configured delay", async () => {
    const h = await harness([
      { status: 429, body: JSON.stringify({ error: { code: 429, message: "rate limited" } }), headers: { "retry-after": "5" } },
      { status: 200, body: JSON.stringify({ error: { code: 503, message: "upstream unavailable" } }) },
      jevReply("blocked", 0.91)
    ]);
    try {
      const attemptId = randomUUID();
      expect(await h.run(attemptId)).toMatchObject({ state: "valid", result: { disposition: "reject" } });
      expect(h.remote.sent).toHaveLength(3);
      expect(h.sleeps).toEqual([5_000, 8_000]);
      const saved = await h.store.readAttempt(attemptId);
      expect(saved!.requests.map(r => [r.httpStatus, r.retryable, r.chargeStatus])).toEqual([[429, true, "unknown"], [200, true, "unknown"], [200, false, "known"]]);
    } finally { await h.close(); }
  });

  it("fails the trial after the initial request and two retries, without a fourth request", async () => {
    const busy = { status: 503, body: "busy" };
    const h = await harness([busy, busy, busy]);
    try {
      expect(await h.run()).toMatchObject({ state: "failed", code: "retries_exhausted" });
      expect(h.remote.sent).toHaveLength(3);
    } finally { await h.close(); }
  });

  it("stops and reports the next eligible time when Retry-After exceeds the maximum wait, keeping the allowance across restart", async () => {
    const first = await harness([{ status: 429, body: "slow down", headers: { "retry-after": "120" } }]);
    try {
      const attemptId = randomUUID();
      const blocked = await first.run(attemptId);
      expect(blocked).toEqual({ attemptId, state: "paused", code: "retry_deferred", nextEligibleAt: "2026-10-04T12:02:00.000Z" });
      expect(first.remote.sent).toHaveLength(1);

      // A restarted process later: the earlier request still counts.
      const restarted = await harness([{ status: 503, body: "busy" }, { status: 503, body: "busy" }], { keys: first.keys, dir: first.dir });
      const later = createStageExecutor({
        store: restarted.store, ledger: restarted.ledger, settings,
        model: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: restarted.remote.fetch }),
        now: () => new Date("2026-10-04T12:03:00Z"), sleep: async () => {}
      });
      expect(await later.execute({ experimentId: first.experimentId, attemptId, stage, input: { headword: "exuberant" } }))
        .toMatchObject({ state: "failed", code: "retries_exhausted" });
      expect(restarted.remote.sent).toHaveLength(2);
      await restarted.close();
    } finally { await first.close(); }
  });

  it.each([
    [401, "credentials_rejected"], [402, "insufficient_credits"], [400, "request_rejected"]
  ])("stops on HTTP %i without retrying", async (status, code) => {
    const h = await harness([{ status, body: JSON.stringify({ error: { code: status, message: "no" } }) }]);
    try {
      expect(await h.run()).toMatchObject({ state: "failed", code });
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });

  it("saves a malformed or wrong-model reply as an invalid trial and makes no repair call, even on resume", async () => {
    const h = await harness([{ status: 200, body: "{truncated" }, jevReply("clear", 0.1, { model: "typesafe/jev-1.13-20261001" })]);
    try {
      const malformed = randomUUID();
      expect(await h.run(malformed)).toMatchObject({ state: "invalid", code: "malformed_reply" });
      expect(await h.run(malformed)).toMatchObject({ state: "invalid", code: "malformed_reply" });
      expect(await h.run()).toMatchObject({ state: "invalid", code: "wrong_model" });
      expect(h.remote.sent).toHaveLength(2);
      const saved = await h.store.readAttempt(malformed);
      expect(saved!.requests[0].response).toEqual({ kind: "response", status: 200, body: "{truncated", retryAfter: null, contentType: "text/plain;charset=UTF-8" });
    } finally { await h.close(); }
  });

  it("treats a timeout as uncertain, keeps its reservation and never redispatches it", async () => {
    const h = await harness([{ hang: true }]);
    try {
      const fast = createStageExecutor({
        store: h.store, ledger: h.ledger, settings: { ...settings, requestTimeoutMs: 50 },
        model: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: h.remote.fetch })
      });
      const attemptId = randomUUID();
      const input = { experimentId: h.experimentId, attemptId, stage, input: { headword: "exuberant" } };
      expect(await fast.execute(input)).toEqual({ attemptId, state: "uncertain" });
      expect(await fast.execute(input)).toEqual({ attemptId, state: "uncertain" });
      expect(h.remote.sent).toHaveLength(1);
      expect(await h.store.spend(h.experimentId)).toMatchObject({ outstandingNanoUsd: settings.reservationNanoUsd, unresolvedRequests: 1, knownNanoUsd: 0 });
    } finally { await h.close(); }
  });

  it("blocks before dispatch when the next reservation would exceed the cap", async () => {
    const h = await harness([{ status: 503, body: "busy" }], { capNanoUsd: settings.reservationNanoUsd + 1 });
    try {
      // The 503 has unknown cost, so its reservation stays committed.
      expect(await h.run()).toMatchObject({ state: "paused", code: "budget_exhausted" });
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });

  it("dispatches nothing when the dispatch intent cannot be made durable", async () => {
    const h = await harness([jevReply("clear", 0.1)], { beforeAppend: async () => { throw new Error("disk full"); } });
    try {
      const attemptId = randomUUID();
      expect(await h.run(attemptId)).toEqual({ attemptId, state: "paused", code: "accounting_unavailable" });
      expect(h.remote.sent).toHaveLength(0);
      expect((await h.store.readAttempt(attemptId))!.requests).toMatchObject([{ status: "abandoned", chargeStatus: "none" }]);
    } finally { await h.close(); }
  });

  it("keeps the charge in PostgreSQL and stops when the outcome receipt cannot be written", async () => {
    const h = await harness([jevReply("clear", 0.1)], { beforeAppend: async type => { if (type === "request_outcome") throw new Error("disk full"); } });
    try {
      const attemptId = randomUUID();
      expect(await h.run(attemptId)).toEqual({ attemptId, state: "paused", code: "accounting_unavailable" });
      expect(await h.store.readAttempt(attemptId)).toMatchObject({ status: "valid", requests: [{ chargeStatus: "known", chargeNanoUsd: 17_304 }] });
      // Resume keeps stopping until the missing receipt can be restored.
      expect(await h.run(attemptId)).toEqual({ attemptId, state: "paused", code: "accounting_unavailable" });
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });

  it("retries a transient PostgreSQL write with the reply in memory and makes no new model call", async () => {
    let failures = 2;
    const h = await harness([jevReply("clear", 0.1)], { beforeWrite: async operation => {
      if (operation === "record_outcome" && failures-- > 0) throw new Error("connection reset");
    } });
    try {
      expect(await h.run()).toMatchObject({ state: "valid" });
      expect(h.remote.sent).toHaveLength(1);
      expect(h.sleeps).toEqual([250, 1_000]);
    } finally { await h.close(); }
  });

  it("records a lost reply as a visible failure with its ledger charge after PostgreSQL stays down", async () => {
    let down = true;
    const h = await harness([jevReply("clear", 0.1)], { beforeWrite: async operation => {
      if (down && operation === "record_outcome") throw new Error("database down");
    } });
    try {
      const attemptId = randomUUID();
      expect(await h.run(attemptId)).toEqual({ attemptId, state: "paused", code: "storage_unavailable" });
      down = false;
      const restarted = await harness([], { keys: h.keys, dir: h.dir });
      const executor = createStageExecutor({ store: restarted.store, ledger: restarted.ledger, settings,
        model: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: restarted.remote.fetch }) });
      expect(await executor.execute({ experimentId: h.experimentId, attemptId, stage, input: { headword: "exuberant" } }))
        .toEqual({ attemptId, state: "response_lost" });
      expect(await restarted.store.readAttempt(attemptId)).toMatchObject({ requests: [{ status: "responded", chargeStatus: "known", chargeNanoUsd: 17_304, response: null }] });
      expect(h.remote.sent.length + restarted.remote.sent.length).toBe(1);
      await restarted.close();
    } finally { await h.close(); }
  });

  it("re-validates a saved reply when the process stopped before the terminal write", async () => {
    let down = true;
    const h = await harness([jevReply("blocked", 0.8)], { beforeWrite: async operation => {
      if (down && operation === "finish_attempt") throw new Error("database down");
    } });
    try {
      const attemptId = randomUUID();
      expect(await h.run(attemptId)).toMatchObject({ state: "paused", code: "storage_unavailable" });
      down = false;
      expect(await h.run(attemptId)).toMatchObject({ state: "valid", result: { disposition: "reject" } });
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });

  it("refuses to resume an attempt with a different input", async () => {
    const h = await harness([jevReply("clear", 0.1)]);
    try {
      const attemptId = randomUUID();
      await h.run(attemptId);
      await expect(h.run(attemptId, "other")).rejects.toThrow("attempt_input_mismatch");
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });

  it("stops before any database work or dispatch when the storage key is unavailable", async () => {
    const keys = await harmlessKeys();
    keys.setAvailable(false);
    await expect(createPrivateStore({ connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto })).rejects.toThrow("key_unavailable");
  });

  it("marks a request in flight when its process was killed as uncertain and does not redispatch it", async () => {
    const h = await harness([]);
    try {
      const attemptId = randomUUID();
      const child = spawn(process.execPath, ["--import", "tsx", resolve(REPO, "pipeline/testing/dispatch-worker.ts")], { stdio: ["pipe", "pipe", "ignore"] });
      const exited = new Promise<void>(done => child.once("exit", () => done()));
      await new Promise<void>((done, reject) => {
        child.stdout.on("data", bytes => { if (bytes.toString().includes("dispatched")) done(); });
        child.once("exit", () => reject(new Error("worker_exited_early")));
        child.stdin.end(JSON.stringify({ url: database.pipelineUrl, storageKey: h.keys.storageKey, identities: Object.fromEntries(h.keys.identities),
          ledgerDir: h.dir + "/ledger", settings, experimentId: h.experimentId, attemptId }));
      });
      child.kill("SIGKILL");
      await exited;
      expect(await h.run(attemptId)).toEqual({ attemptId, state: "uncertain" });
      expect(h.remote.sent).toHaveLength(0);
      expect(await h.store.spend(h.experimentId)).toMatchObject({ unresolvedRequests: 1, outstandingNanoUsd: settings.reservationNanoUsd });
    } finally { await h.close(); }
  }, 30_000);

  it("abandons a reservation whose dispatch intent never became durable, then dispatches once", async () => {
    // Simulates a process that stopped between reserving and writing the intent:
    // both the intent and the immediate abandonment fail, leaving the row reserved.
    let crash = true;
    const h = await harness([jevReply("clear", 0.1)], {
      beforeAppend: async () => { if (crash) throw new Error("process stopped"); },
      beforeWrite: async operation => { if (crash && operation === "abandon_request") throw new Error("process stopped"); }
    });
    try {
      const attemptId = randomUUID();
      expect(await h.run(attemptId)).toMatchObject({ state: "paused", code: "storage_unavailable" });
      expect((await h.store.readAttempt(attemptId))!.requests.map(r => r.status)).toEqual(["reserved"]);
      crash = false;
      expect(await h.run(attemptId)).toMatchObject({ state: "valid" });
      expect(h.remote.sent).toHaveLength(1);
      expect((await h.store.readAttempt(attemptId))!.requests.map(r => r.status)).toEqual(["abandoned", "responded"]);
    } finally { await h.close(); }
  });

  it("restores a receipt that a failed append left out before dispatching a retry", async () => {
    let ledgerDown = true;
    const h = await harness([{ status: 429, body: "slow down" }, jevReply("clear", 0.1)], {
      beforeAppend: async type => { if (ledgerDown && type === "request_outcome") throw new Error("disk full"); }
    });
    try {
      const attemptId = randomUUID();
      expect(await h.run(attemptId)).toEqual({ attemptId, state: "paused", code: "accounting_unavailable" });
      expect(h.remote.sent).toHaveLength(1);
      ledgerDown = false;
      expect(await h.run(attemptId)).toMatchObject({ state: "valid" });
      const saved = await h.store.readAttempt(attemptId);
      const outcomes = (await h.ledger.read()).filter(e => e.type === "request_outcome").map(e => e.requestId);
      expect(outcomes).toEqual(saved!.requests.map(r => r.id));
      expect(h.remote.sent).toHaveLength(2);
    } finally { await h.close(); }
  });

  it("defers rather than failing to save an extreme Retry-After", async () => {
    const h = await harness([{ status: 429, body: "slow down", headers: { "retry-after": "99999999999" } }]);
    try {
      expect(await h.run()).toMatchObject({ state: "paused", code: "retry_deferred" });
    } finally { await h.close(); }
  });

  it("keeps working after many abandoned reservations", async () => {
    let failures = 12;
    const h = await harness([jevReply("clear", 0.1)], { beforeAppend: async type => {
      if (type === "dispatch_intent" && failures-- > 0) throw new Error("disk full");
    } });
    try {
      const attemptId = randomUUID();
      for (let i = 0; i < 12; i++) expect(await h.run(attemptId)).toMatchObject({ state: "paused", code: "accounting_unavailable" });
      const last = await h.run(attemptId);
      expect(last).toMatchObject({ state: "valid" });
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });
});
