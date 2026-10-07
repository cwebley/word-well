// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createProductionCoordinator } from "./run.js";
import { createPrivateStore } from "./storage/postgres.js";
import { createSourceStore } from "./storage/sources.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { createSystemOneAdapter } from "./execution/system-one.js";
import { createAppropriatenessStage, APPROPRIATENESS_CONFIGURATION } from "./stages/appropriateness.js";
import { buildScopedCandidate, authorizeScopedCandidate } from "./sources/index.js";
import { loadPipelineConfig, fingerprint } from "./config.js";
import { executionSettings } from "./production-config.js";
import { createPrivateAppropriatenessRunner, implementationIdentity, loadLocalConfig } from "../evals/private-appropriateness.js";
import { frozenDataset } from "../evals/private-fixtures.js";
import { assessSavedPromotion, recordOwnerPromotion } from "./promotion.js";
import { fixturePool, harmlessKeys, jevReply, scriptedFetch, privateTempDir, testDatabase, REPO, type ScriptedReply } from "./testing/private-fixtures.js";
import { PrivateError } from "./storage/crypto.js";
import { bundleSchema, type EvidenceBundle } from "./sources/bundle.js";
import { openLocalSourceStore } from "./storage/source-local.js";
import { usefulnessMeasurements, usefulnessReply } from "./testing/usefulness-fixtures.js";
import { combineTrials, createUsefulnessStage, features, usefulnessConfiguration } from "./stages/usefulness.js";
import { PRODUCTION_COMBINER } from "./stages/usefulness-production.js";
import { recordApprovedUsefulnessPromotion } from "./usefulness-promotion.js";
import { createDurableUsefulnessEvaluator } from "../evals/durable-usefulness.js";

const config = loadLocalConfig(JSON.parse(await readFile(resolve(REPO, "config/private-appropriateness.json"), "utf8")));
const intake = await loadPipelineConfig(resolve(REPO, "config/pipeline.yaml"));
const clear = () => jevReply("clear", 0.1, {}, 0.1);
const stage = createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION);
let evidence: EvidenceBundle;
describe.skipIf(!process.env.DATABASE_URL)("production appropriateness coordinator", () => {
  beforeAll(async () => {
    if (process.env.WORDWELL_PRODUCTION_READY_BUNDLE) {
      // Local walkthrough reads the already ready development bundle only.
      // All production/test writes still go to unique disposable databases.
      const source = await openLocalSourceStore();
      try { evidence = await source.readyBundle(process.env.WORDWELL_PRODUCTION_READY_BUNDLE); }
      finally { await source.close(); }
    } else {
      evidence = bundleSchema.parse({ scope: { controlled: true }, artifacts: [],
        entries: [{ source: "oewn", id: "oewn-emulate-v", headword: "emulate", pos: "v", order: 1, role: "candidate", raw: "harmless-source-marker", rawSha256: "a".repeat(64), locator: {}, data: { forms: [] } },
          { source: "kaikki", id: "standin", headword: "emulate", pos: "verb", order: 1, role: "candidate", raw: "harmless-source-marker", rawSha256: "a".repeat(64), locator: {}, data: { word: "emulate", pos: "verb", senses: Array.from({ length: 5 }, () => ({ glosses: ["harmless-source-marker"] })) } }],
        meanings: [], concepts: [], relations: [], frequency: { order: 16960, form: "emulate", tokens: ["emulate"], storedFrequency: 0.0000025703957827688647, directZipf: 3.41 },
        supplemental: { page_id: "7577", revision_id: "92422846", text_sha256: "02467344b0af9e5085e9980648e09cd6326f42480affb9e77146686ec7584551", raw_wikitext: "harmless-source-marker", authenticatesKaikki: false, meanings: [] },
        diagnostics: [], coverage: { candidates: ["emulate"], fullCorpus: false, oewnMeanings: 3, kaikkiMeanings: 5 }, modelCalls: 0 });
    }
  });
  async function harness(script: ScriptedReply[], faults: { write?: (operation: string) => Promise<void>; append?: (type: string) => Promise<void> } = {}) {
    const database = await testDatabase(), keys = await harmlessKeys(), temp = await privateTempDir();
    const options = { connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto };
    const store = await createPrivateStore({ ...options, beforeWrite: faults.write });
    const sources = await createSourceStore(options);
    const bundleId = fingerprint({ testEvidence: evidence });
    await sources.importBundle({ id: bundleId, intention: { controlledCopy: true }, load: async () => evidence });
    await buildScopedCandidate(sources, bundleId, intake);
    const ledger = await createReceiptLedger({ directory: resolve(temp.root, "ledger"), checkout: REPO, beforeAppend: faults.append });
    const remote = scriptedFetch(script);
    const model = createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch });
    let currentPolicy = intake;
    const currentIntake = async () => currentPolicy;
    const coordinator = createProductionCoordinator({ store, sources, ledger, currentIntake, execution: { kind: "controlled", model }, sleep: async () => {} });
    const create = (fresh = false, selectedIntake = intake, capNanoUsd = 100_000_000) => {
      currentPolicy = selectedIntake;
      return coordinator.create({ bundleId, candidate: "emulate", intake: selectedIntake, config, capNanoUsd, stageOnly: true, fresh });
    };
    const admin = fixturePool(database.adminUrl);
    return { database, keys, options, store, sources, ledger, remote, model, currentIntake, setIntake: (value: typeof intake) => { currentPolicy = value; }, coordinator, create, admin, bundleId, temp,
      close: async () => { await Promise.all([store.close(), sources.close(), admin.end()]); await database.drop(); await temp.cleanup(); } };
  }
  it("selects the unrounded three-trial verdict, reuses unchanged work and rechecks changed intake separately", async () => {
    const h = await harness([jevReply("blocked", 0.8, {}, 0.2), clear(), clear()]);
    try {
      const id = await h.create();
      const result = await h.coordinator.run(id);
      expect(result).toMatchObject({ status: "accepted", spend: { physicalRequests: 3, knownNanoUsd: 51_912 }, material: { mode: "stage-only" } });
      expect(result.selected?.material).toMatchObject({ decision: { blockedProbability: 1 / 3, slurProbability: (0.2 + 0.1 + 0.1) / 3, disposition: "accept" } });
      expect(h.remote.sent.map(r => JSON.parse(r.body))).toEqual([stage.render({ headword: "emulate" }), stage.render({ headword: "emulate" }), stage.render({ headword: "emulate" })]);
      expect(h.remote.sent.some(r => r.body.includes("harmless-source-marker"))).toBe(false);
      const again = await h.create();
      expect((await h.coordinator.run(again)).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(3);
      expect((await h.coordinator.inspect(again)).history).toHaveLength(1);
      const changed = structuredClone(intake); changed.filters.frequency.ceiling = 3.6;
      await buildScopedCandidate(h.sources, h.bundleId, changed);
      const authorized = await h.create(false, changed);
      expect((await h.coordinator.run(authorized)).spend.physicalRequests).toBe(0);
      const excluded = structuredClone(intake); excluded.filters.frequency.ceiling = 3.4;
      await buildScopedCandidate(h.sources, h.bundleId, excluded);
      await expect(h.create(false, excluded)).rejects.toThrow("candidate_intake_not_passing");
      await expect(h.create(false, intake, 0)).rejects.toThrow("cap_invalid");
      expect(h.remote.sent).toHaveLength(3);
      const rows = (await h.admin.query("SELECT payload FROM private.production_runs UNION ALL SELECT payload FROM private.production_results")).rows;
      expect(rows.every(r => !r.payload.toString().includes("emulate"))).toBe(true);
      expect(JSON.stringify(await h.ledger.read())).not.toMatch(/emulate|harmless-source-marker/);
    } finally { await h.close(); }
  }, 30_000);
  it("keeps an earlier selection on failed fresh work, then selects a fresh rejection including slur ties", async () => {
    const h = await harness([clear(), clear(), clear(), { status: 200, body: "{harmless-invalid-marker" },
      ...Array.from({ length: 3 }, () => jevReply("clear", 0.1, {}, 0.4))]);
    try {
      const first = await h.coordinator.run(await h.create());
      const failed = await h.coordinator.run(await h.create(true));
      expect(failed).toMatchObject({ status: "failed", outcomeCode: "malformed_reply" });
      expect(failed.selected?.id).toBe(first.selected?.id);
      expect((await h.coordinator.run(failed.id)).spend.physicalRequests).toBe(1);
      const rejected = await h.coordinator.run(await h.create(true));
      expect(rejected).toMatchObject({ status: "rejected" });
      expect(rejected.selected?.id).not.toBe(first.selected?.id);
      expect(rejected.selected?.material).toMatchObject({ decision: { slurProbability: (0.4 + 0.4 + 0.4) / 3, disposition: "reject" } });
      expect(rejected.history).toHaveLength(2);
      expect((await h.coordinator.run(await h.create())).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(7);
      await expect(h.admin.query("UPDATE private.attempts SET outcome_code='tampered' WHERE run_id=$1", [failed.id])).rejects.toMatchObject({ code: "55000" });
    } finally { await h.close(); }
  });
  it("prevents unpromoted live dispatch and downstream permission, even with a controlled acceptance", async () => {
    const h = await harness([clear(), clear(), clear()]);
    try {
      const live = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "live", model: h.model } });
      await expect(live.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 1_000_000 })).rejects.toThrow("configuration_not_promoted");
      await h.coordinator.run(await h.create());
      await expect(h.coordinator.authorizeDownstream({ bundleId: h.bundleId, intake })).rejects.toThrow("configuration_not_promoted");
      expect(h.remote.sent).toHaveLength(3);
      const noLabels = await createPrivateStore(h.options);
      try { await expect(noLabels.readExpectations(randomUUID())).rejects.toThrow("dataset_key_required"); }
      finally { await noLabels.close(); }
      const learner = fixturePool(h.database.learnerUrl);
      try {
        for (const table of ["production_runs", "candidate_claims", "production_trials", "production_results", "stage_selections", "selection_history", "reuse_authorizations", "promotion_assessments", "stage_promotions"]) await expect(learner.query(`SELECT * FROM private.${table}`)).rejects.toMatchObject({ code: "42501" });
      } finally { await learner.end(); }
    } finally { await h.close(); }
  });
  it("blocks overlapping commands, requires stopped-owner recovery and fences stale selection writes", async () => {
    const h = await harness([clear(), clear(), clear()]);
    try {
      const firstId = await h.create(), secondId = await h.create();
      const candidate = await authorizeScopedCandidate(h.sources, h.bundleId, intake);
      const claim = await h.store.claimCandidate(candidate.candidateId, firstId);
      await expect(h.coordinator.run(secondId)).rejects.toThrow("candidate_busy");
      await expect(h.coordinator.recover(firstId)).rejects.toThrow("candidate_busy");
      expect((await h.coordinator.inspect(secondId)).claimOwnerRunId).toBe(firstId);
      await claim.release();
      await expect(h.coordinator.run(secondId)).rejects.toThrow("candidate_recovery_required");
      expect((await h.coordinator.recover(firstId)).status).toBe("paused");
      await expect(h.store.completeProduction(claim, { status: "accepted" })).rejects.toThrow("claim_stale");
      expect(h.remote.sent).toHaveLength(0);
      expect((await h.coordinator.run(firstId)).status).toBe("accepted");
      expect((await h.coordinator.run(secondId)).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(3);
    } finally { await h.close(); }
  });
  it("recovers dispatch intent without outcome as uncertain and never redispatches it", async () => {
    const h = await harness([]);
    try {
      const id = await h.create();
      const candidate = await authorizeScopedCandidate(h.sources, h.bundleId, intake);
      const claim = await h.store.claimCandidate(candidate.candidateId, id);
      const attemptId = await h.store.productionTrial(id, 1), requestId = randomUUID();
      await h.store.createAttempt({ id: attemptId, runId: id, stage: stage.name, input: { input: candidate.appropriatenessInput, request: stage.render(candidate.appropriatenessInput) } });
      await h.store.reserveRequest({ requestId, runId: id, attemptId, sequence: 1, reservedNanoUsd: 1_344_000, at: new Date() });
      await h.ledger.append({ type: "dispatch_intent", eventId: randomUUID(), at: new Date().toISOString(), runId: id, attemptId, requestId, sequence: 1, reservedNanoUsd: 1_344_000 });
      await claim.release();
      const recovered = await h.coordinator.recover(id);
      expect(recovered).toMatchObject({ status: "failed", outcomeCode: "uncertain", spend: { physicalRequests: 1, unresolvedRequests: 1, outstandingNanoUsd: 1_344_000 } });
      expect(recovered.trials[0].attempt?.status).toBe("uncertain");
      await h.coordinator.run(id); await h.coordinator.recover(id);
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  });
  it("retains ledger accounting when storage loses a reply and resumes to response_lost without another call", async () => {
    let fail = true;
    const h = await harness([clear()], { write: async operation => { if (fail && operation === "record_outcome") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create();
      expect((await h.coordinator.run(id)).status).toBe("paused");
      expect(h.remote.sent).toHaveLength(1);
      fail = false;
      // Reopen the actual encrypted store, as a restarted command would.
      const restarted = await createPrivateStore(h.options);
      try {
        const runner = createProductionCoordinator({ store: restarted, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "controlled", model: h.model }, sleep: async () => {} });
        const recovered = await runner.recover(id);
        expect(recovered).toMatchObject({ status: "failed", outcomeCode: "response_lost", spend: { physicalRequests: 1, knownNanoUsd: 17_304, unresolvedRequests: 0 } });
        await runner.run(id);
      } finally { await restarted.close(); }
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  });
  it("stops when accounting is unavailable, then saves receipts before finishing the remaining trials", async () => {
    let blockIntent = true, blockOutcome = false;
    const h = await harness([clear(), clear(), clear()], { append: async type => {
      if (type === "dispatch_intent" && blockIntent || type === "request_outcome" && blockOutcome) throw new PrivateError("accounting_unavailable");
    } });
    try {
      const id = await h.create();
      expect((await h.coordinator.run(id)).outcomeCode).toBe("accounting_unavailable");
      expect(h.remote.sent).toHaveLength(0);
      blockIntent = false; blockOutcome = true;
      expect((await h.coordinator.run(id)).outcomeCode).toBe("accounting_unavailable");
      expect(h.remote.sent).toHaveLength(1);
      blockOutcome = false;
      expect((await h.coordinator.run(id)).status).toBe("accepted");
      expect(h.remote.sent).toHaveLength(3);
      expect((await h.ledger.read()).filter(r => r.type === "request_outcome")).toHaveLength(3);
      expect((await h.coordinator.inspect(id)).spend.unresolvedRequests).toBe(0);
    } finally { await h.close(); }
  });
  it("honors reservations, bounded transport retries and incompatible recorded implementations", async () => {
    const h = await harness([{ status: 503, body: "harmless-busy-marker" }, { status: 503, body: "harmless-busy-marker" }, { status: 503, body: "harmless-busy-marker" }]);
    try {
      const insufficient = await h.create(false, intake, 1_000_000);
      expect((await h.coordinator.run(insufficient)).outcomeCode).toBe("budget_exhausted");
      const competing = await h.create();
      await expect(h.coordinator.run(competing)).rejects.toThrow("candidate_recovery_required");
      await h.coordinator.recover(insufficient);
      const id = await h.create();
      const changed = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "controlled", model: h.model }, implementation: "0".repeat(64) });
      await expect(changed.run(id)).rejects.toThrow("implementation_changed");
      expect(h.remote.sent).toHaveLength(0);
      expect((await h.coordinator.run(id))).toMatchObject({ status: "failed", outcomeCode: "retries_exhausted", spend: { physicalRequests: 3, unresolvedRequests: 3, outstandingNanoUsd: 4_032_000 } });
      expect(h.remote.sent).toHaveLength(3);
      await expect(h.admin.query("UPDATE private.production_runs SET cap_nano_usd=200000000 WHERE id=$1", [id])).rejects.toMatchObject({ code: "55000" });
    } finally { await h.close(); }
  });
  it("serializes two real coordinators while the first model request is in flight", async () => {
    const h = await harness([clear(), clear(), clear()]);
    let started!: () => void, continueRequest!: () => void;
    const inFlight = new Promise<void>(resolve => { started = resolve; });
    const continuePromise = new Promise<void>(resolve => { continueRequest = resolve; });
    let first = true;
    const model = { ...h.model, send: async (body: unknown, options: { timeoutMs: number }) => {
      if (first) { first = false; started(); await continuePromise; }
      return h.model.send(body, options);
    } };
    const runner = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "controlled", model } });
    try {
      const a = await h.create(), b = await h.create();
      const work = runner.run(a);
      await inFlight;
      await expect(h.coordinator.run(b)).rejects.toThrow("candidate_busy");
      continueRequest();
      expect((await work).status).toBe("accepted");
      expect((await h.coordinator.run(b)).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(3);
    } finally { continueRequest(); await h.close(); }
  });
  it("refuses historical intake permission after policy changes and recovers saved replies without calls", async () => {
    let failFinish = true, transient = true;
    const h = await harness([clear(), clear(), clear()], { write: async operation => {
      if (operation === "record_outcome" && transient) { transient = false; throw new PrivateError("storage_unavailable"); }
      if (operation === "finish_attempt" && failFinish) throw new PrivateError("storage_unavailable");
    } });
    try {
      const id = await h.create();
      const excluded = structuredClone(intake); excluded.filters.frequency.ceiling = 3.4;
      await buildScopedCandidate(h.sources, h.bundleId, excluded); h.setIntake(excluded);
      await expect(h.coordinator.run(id)).rejects.toThrow("candidate_intake_not_passing");
      expect(h.remote.sent).toHaveLength(0);
      h.setIntake(intake);
      expect((await h.coordinator.run(id))).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable" });
      expect(h.remote.sent).toHaveLength(1);
      failFinish = false;
      expect((await h.coordinator.recover(id))).toMatchObject({ status: "paused", outcomeCode: "recovered_without_dispatch" });
      expect(h.remote.sent).toHaveLength(1);
      expect((await h.coordinator.run(id)).status).toBe("accepted");
      expect(h.remote.sent).toHaveLength(3);
    } finally { await h.close(); }
  });
  it("rechecks terminal status under ownership when a delayed resume read pending progress", async () => {
    const h = await harness([clear(), clear(), clear()]);
    let reachedClaim!: () => void, acquire!: () => void;
    const delayed = new Promise<void>(resolve => { reachedClaim = resolve; });
    const proceed = new Promise<void>(resolve => { acquire = resolve; });
    const runner = createProductionCoordinator({ store: { ...h.store, claimCandidate: async (...args) => { reachedClaim(); await proceed; return h.store.claimCandidate(...args); } },
      sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "controlled", model: h.model } });
    try {
      const id = await h.create();
      const late = runner.run(id);
      await delayed;
      const completed = await h.coordinator.run(id);
      acquire();
      expect((await late).status).toBe("accepted");
      expect(await h.store.candidateClaim(completed.candidateId)).toBeNull();
      expect((await h.coordinator.run(await h.create())).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(3);
    } finally { acquire(); await h.close(); }
  });
  it("handles a lost lock connection with a fixed code and proves stopped ownership before recovery", async () => {
    const h = await harness([clear(), clear(), clear()]);
    let dispatched!: () => void, finishReply!: () => void;
    const sending = new Promise<void>(resolve => { dispatched = resolve; });
    const wait = new Promise<void>(resolve => { finishReply = resolve; });
    let first = true;
    const model = { ...h.model, send: async (body: unknown, settings: { timeoutMs: number }) => {
      if (first) { first = false; dispatched(); await wait; }
      return h.model.send(body, settings);
    } };
    const runner = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "controlled", model } });
    try {
      const id = await h.create();
      const work = runner.run(id);
      // Attach before terminating the connection so rejected work never becomes
      // an unhandled promise carrying driver details.
      const outcome = work.catch(error => error);
      await sending;
      const candidate = await authorizeScopedCandidate(h.sources, h.bundleId, intake);
      const killed = await h.admin.query("SELECT pg_terminate_backend(pid) AS stopped FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=hashtext('wordwell:candidate')::oid AND objid=hashtext($1)::oid", [candidate.candidateId]);
      expect(killed.rows).toEqual([{ stopped: true }]);
      await new Promise(resolve => setTimeout(resolve, 20));
      finishReply();
      expect(await outcome).toMatchObject({ code: "claim_stale" });
      expect(h.remote.sent).toHaveLength(1);
      await h.coordinator.recover(id);
      expect(h.remote.sent).toHaveLength(1);
      expect((await h.coordinator.run(id)).status).toBe("accepted");
      expect(h.remote.sent).toHaveLength(3);
    } finally { finishReply(); await h.close(); }
  });
  it("uses exact owner promotion for normal dispatch and downstream authorization, and honors a later non-promotion", async () => {
    const h = await harness([...Array.from({ length: 6 }, clear), ...Array.from({ length: 3 }, () => usefulnessReply())]);
    const d = await frozenDataset([{ headword: "exuberant", finding: "clear", split: "held-out" }]);
    // Same production storage identity; owner labels remain under the separate
    // disposable dataset identity. Neither identity is installed in Keychain.
    const crypto = { verify: (key: typeof h.keys.storageKey) => (key.id.startsWith("ww-storage-") ? h.keys.crypto : d.f.crypto).verify(key),
      encrypt: (key: typeof h.keys.storageKey, id: string, value: unknown) => (key.id.startsWith("ww-storage-") ? h.keys.crypto : d.f.crypto).encrypt(key, id, value),
      decrypt: <T>(key: typeof h.keys.storageKey, id: string, bytes: Uint8Array, schema: import("zod").z.ZodType<T>) => (key.id.startsWith("ww-storage-") ? h.keys.crypto : d.f.crypto).decrypt(key, id, bytes, schema) };
    const evaluationStore = await createPrivateStore({ ...h.options, datasetKey: d.f.datasetKey, crypto });
    const evalRemote = scriptedFetch(Array.from({ length: 3 }, clear));
    const evalLedger = await createReceiptLedger({ directory: resolve(d.f.root, "ledger"), checkout: REPO });
    const evaluator = createPrivateAppropriatenessRunner({ store: evaluationStore, ledger: evalLedger,
      models: { "openrouter-systemone-v1": createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: evalRemote.fetch }) }, implementation: await implementationIdentity() });
    try {
      const experimentId = await evaluator.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto,
        capNanoUsd: 100_000_000, configuration: APPROPRIATENESS_CONFIGURATION, config, split: "held-out" });
      await evaluator.run(experimentId);
      await evaluator.finalize(experimentId, { summariesDir: resolve(d.f.root, "summaries") });
      const assessment = await assessSavedPromotion({ store: evaluationStore, datasetDir: d.datasetDir, manifest: d.manifest, crypto: d.f.crypto, experimentId });
      expect(assessment.qualifies).toBe(true);
      const owner = { schema: "wordwell-owner-stage-promotion-v1", reviewer: "local-owner", issue: "https://github.com/cwebley/word-well/issues/17",
        decisionReference: "https://github.com/cwebley/word-well/issues/17#issuecomment-1", assessmentId: assessment.id, decision: "promote" };
      const promotion = await recordOwnerPromotion(h.store, owner);
      await h.coordinator.run(await h.create());
      await expect(h.coordinator.authorizeDownstream({ bundleId: h.bundleId, intake, stage: "appropriateness" })).rejects.toThrow("appropriateness_not_accepted");
      const noKey = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake,
        beforeDispatch: async () => { throw new PrivateError("model_key_required"); }, execution: { kind: "live", model: h.model } });
      const blockedId = await noKey.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000, stageOnly: true });
      await expect(noKey.run(blockedId)).rejects.toThrow("model_key_required");
      expect((await noKey.inspect(blockedId)).spend).toMatchObject({ physicalRequests: 0, outstandingNanoUsd: 0 });
      await noKey.recover(blockedId);
      await recordApprovedUsefulnessPromotion(h.store);
      const live = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "live", model: h.model } });
      const runId = await live.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000 });
      expect((await live.run(runId)).status).toBe("accepted");
      expect(await live.authorizeDownstream({ bundleId: h.bundleId, intake, stage: "appropriateness" })).toMatchObject({ promotionId: promotion.id });
      expect(await live.authorizeDownstream({ bundleId: h.bundleId, intake })).toMatchObject({ appropriatenessPromotionId: promotion.id });
      const reused = await live.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000 });
      expect((await live.run(reused)).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(9);
      expect(evalRemote.sent).toHaveLength(3);
      await recordOwnerPromotion(h.store, { ...owner, decision: "do_not_promote" });
      await expect(live.authorizeDownstream({ bundleId: h.bundleId, intake })).rejects.toThrow("configuration_not_promoted");
      await expect(live.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000 })).rejects.toThrow("configuration_not_promoted");
      expect(h.remote.sent).toHaveLength(9);
    } finally { await evaluationStore.close(); await d.f.cleanup(); await h.close(); }
  }, 30_000);
  it("durably cancels permission revoked before send instead of manufacturing an uncertain request", async () => {
    let failCancellationWrite = false;
    const h = await harness([], { write: async operation => { if (failCancellationWrite && operation === "abandon_request") throw new PrivateError("storage_unavailable"); } });
    let checks = 0;
    const runner = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake,
      execution: { kind: "controlled", model: h.model }, beforeDispatch: async () => { if (++checks === 2) throw new PrivateError("configuration_not_promoted"); } });
    try {
      const id = await h.create();
      expect(await runner.run(id)).toMatchObject({ status: "failed", outcomeCode: "dispatch_cancelled", spend: { physicalRequests: 0, outstandingNanoUsd: 0, unresolvedRequests: 0 } });
      expect((await h.ledger.read()).map(r => r.type)).toEqual(["dispatch_intent", "dispatch_cancelled"]);
      await runner.recover(id);
      checks = 0; failCancellationWrite = true;
      const interrupted = await h.create(true);
      expect((await runner.run(interrupted))).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable" });
      failCancellationWrite = false;
      expect((await runner.recover(interrupted))).toMatchObject({ status: "failed", outcomeCode: "dispatch_cancelled", spend: { physicalRequests: 0, outstandingNanoUsd: 0 } });
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  });
  it("cannot commit a selection after the claim session dies between assertion and result persistence", async () => {
    const h = await harness([clear(), clear(), clear()]);
    let kill = true;
    const crypto = { ...h.keys.crypto, encrypt: async (...args: Parameters<typeof h.keys.crypto.encrypt>) => {
      const bytes = await h.keys.crypto.encrypt(...args);
      if (kill && args[1].startsWith("production_results:")) {
        kill = false;
        await h.admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=hashtext('wordwell:candidate')::oid");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return bytes;
    } };
    const store = await createPrivateStore({ ...h.options, crypto });
    const runner = createProductionCoordinator({ store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "controlled", model: h.model } });
    try {
      const id = await h.create();
      await expect(runner.run(id)).rejects.toThrow("claim_stale");
      const stopped = await h.coordinator.inspect(id);
      expect(stopped.selected).toBeNull();
      expect(stopped.history).toHaveLength(0);
      expect(h.remote.sent).toHaveLength(3);
      await h.coordinator.recover(id);
      expect((await h.coordinator.run(id)).status).toBe("accepted");
      expect(h.remote.sent).toHaveLength(3);
    } finally { await store.close(); await h.close(); }
  });
  it("imports a late known charge for a terminal uncertain request without changing its verdict or sending again", async () => {
    let loseLateReply = false;
    const h = await harness([clear()], { write: async operation => { if (loseLateReply && operation === "record_outcome") throw new PrivateError("storage_unavailable"); } });
    let received!: () => void, releaseReply!: () => void;
    const pending = new Promise<void>(resolve => { received = resolve; });
    const wait = new Promise<void>(resolve => { releaseReply = resolve; });
    const model = { ...h.model, send: async (body: unknown, settings: { timeoutMs: number }) => {
      const reply = await h.model.send(body, settings); received(); await wait; return reply;
    } };
    const runner = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "controlled", model }, sleep: async () => {} });
    try {
      const id = await h.create();
      const outcome = runner.run(id).catch(error => error);
      await pending;
      const candidate = await authorizeScopedCandidate(h.sources, h.bundleId, intake);
      await h.admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND locktype='advisory' AND classid=hashtext('wordwell:candidate')::oid AND objid=hashtext($1)::oid", [candidate.candidateId]);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect((await h.coordinator.recover(id))).toMatchObject({ status: "failed", spend: { unresolvedRequests: 1, outstandingNanoUsd: 1_344_000 } });
      loseLateReply = true; releaseReply();
      expect(await outcome).toMatchObject({ code: "claim_stale" });
      loseLateReply = false;
      const recovered = await h.coordinator.recover(id);
      expect(recovered).toMatchObject({ status: "failed", spend: { physicalRequests: 1, knownNanoUsd: 17_304, outstandingNanoUsd: 0, unresolvedRequests: 0 } });
      expect(recovered.trials[0].attempt?.status).toBe("uncertain");
      expect(recovered.trials[0].attempt?.requests[0].status).toBe("no_response");
      await h.coordinator.recover(id);
      expect((await h.coordinator.inspect(id)).spend.knownNanoUsd).toBe(17_304);
      expect(h.remote.sent).toHaveLength(1);
    } finally { releaseReply(); await h.close(); }
  });
  const normal = (h: Awaited<ReturnType<typeof harness>>, fresh = false) => h.coordinator.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000, fresh });
  it("runs both gates, persists original dependencies and authorizes zero-call reuse after fresh acceptance", async () => {
    const h = await harness([...Array.from({ length: 3 }, clear), usefulnessReply(1.75), usefulnessReply(1.8), usefulnessReply(1.85), ...Array.from({ length: 3 }, clear)]);
    try {
      const first = await h.coordinator.run(await normal(h));
      expect(first).toMatchObject({ status: "accepted", spend: { physicalRequests: 6, knownNanoUsd: 303_912 } });
      const input = { headword: "emulate", partsOfSpeech: ["v"] };
      const stage = createUsefulnessStage(usefulnessConfiguration(PRODUCTION_COMBINER));
      expect(h.remote.sent.slice(3).map(r => JSON.parse(r.body))).toEqual(Array.from({ length: 3 }, () => stage.render(input)));
      const answers = [1.75, 1.8, 1.85].map(usefulnessMeasurements), combined = combineTrials(answers, PRODUCTION_COMBINER);
      expect(first.selectedUsefulness?.material).toMatchObject({ input, originalAppropriatenessResultId: first.selected?.id,
        decision: { keepScore: combined.keepScore, verdict: "advance", averagedFeatures: features(answers) } });
      for (const trial of first.trials.filter(t => t.stage === "usefulness")) expect(trial.attempt?.input.provenance).toMatchObject({ appropriatenessResultId: first.selected?.id });
      const reused = await h.coordinator.run(await normal(h));
      expect(reused.spend.physicalRequests).toBe(0);
      expect(reused.authorizations).toHaveLength(2);
      const fresh = await h.coordinator.run(await h.create(true));
      const authorized = await h.coordinator.run(await normal(h));
      expect(authorized.spend.physicalRequests).toBe(0);
      expect(authorized.selectedUsefulness).toEqual(first.selectedUsefulness);
      expect(authorized.authorizations.find(a => a.result_id === first.selectedUsefulness?.id)).toMatchObject({ appropriateness_result_id: fresh.selected?.id });
      expect(h.remote.sent).toHaveLength(9);
      expect(authorized.history).toHaveLength(3);
    } finally { await h.close(); }
  });
  it("stops before usefulness on current rejection or failed fresh appropriateness", async () => {
    const h = await harness([...Array.from({ length: 3 }, clear), ...Array.from({ length: 3 }, () => usefulnessReply()),
      { status: 200, body: "{invalid" }, ...Array.from({ length: 3 }, () => jevReply("blocked", 0.8, {}, 0.1))]);
    try {
      const first = await h.coordinator.run(await normal(h));
      const failed = await h.coordinator.run(await normal(h, true));
      expect(failed.status).toBe("failed"); expect(failed.spend.physicalRequests).toBe(1);
      expect(failed.selectedUsefulness?.id).toBe(first.selectedUsefulness?.id);
      const rejected = await h.coordinator.run(await normal(h, true));
      expect(rejected.status).toBe("rejected"); expect(rejected.spend.physicalRequests).toBe(3);
      expect(rejected.trials.every(t => t.stage === "appropriateness")).toBe(true);
      await expect(h.coordinator.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000, stageOnly: true, stage: "usefulness" })).rejects.toThrow("appropriateness_not_accepted");
      expect((await h.coordinator.run(await normal(h))).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(10);
    } finally { await h.close(); }
  });
  it("supports usefulness-only inspection, invalid fresh output and a selected exclusion without erasing history", async () => {
    const h = await harness([...Array.from({ length: 3 }, clear), ...Array.from({ length: 3 }, () => usefulnessReply()),
      usefulnessReply(1.8, { answers: {} }), ...Array.from({ length: 3 }, () => usefulnessReply(1.9))]);
    const only = () => h.coordinator.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000, stageOnly: true, stage: "usefulness", fresh: true });
    try {
      await expect(only()).rejects.toThrow("appropriateness_not_current");
      await h.coordinator.run(await h.create());
      const accepted = await h.coordinator.run(await only());
      expect(accepted.spend.physicalRequests).toBe(3);
      const failed = await h.coordinator.run(await only());
      expect(failed).toMatchObject({ status: "failed", outcomeCode: "answers_invalid" });
      expect(failed.selectedUsefulness?.id).toBe(accepted.selectedUsefulness?.id);
      expect((await h.coordinator.run(failed.id)).spend.physicalRequests).toBe(1);
      const excluded = await h.coordinator.run(await only());
      expect(excluded.status).toBe("rejected");
      expect(excluded.selectedUsefulness?.material).toMatchObject({ decision: { verdict: "exclude" } });
      expect((await h.coordinator.run(await normal(h))).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(10);
    } finally { await h.close(); }
  });
  it("resumes fresh-all after a usefulness accounting pause without repeating completed appropriateness", async () => {
    let block = true;
    const h = await harness([...Array.from({ length: 3 }, clear), ...Array.from({ length: 3 }, () => usefulnessReply())],
      { append: async type => { if (block && type === "request_outcome" && h.remote.sent.length === 4) throw new PrivateError("accounting_unavailable"); } });
    try {
      const id = await normal(h, true);
      expect((await h.coordinator.run(id))).toMatchObject({ status: "paused", spend: { physicalRequests: 4 } });
      const competitor = await normal(h);
      await expect(h.coordinator.run(competitor)).rejects.toThrow("candidate_recovery_required");
      block = false;
      expect((await h.coordinator.run(id))).toMatchObject({ status: "accepted", spend: { physicalRequests: 6 } });
      expect((await h.coordinator.run(competitor)).spend.physicalRequests).toBe(0);
      expect(h.remote.sent).toHaveLength(6);
      expect((await h.coordinator.inspect(id)).history).toHaveLength(2);
    } finally { await h.close(); }
  });
  it("recovers an uncertain usefulness request without redispatch or an invented verdict", async () => {
    const h = await harness([...Array.from({ length: 3 }, clear), { throws: "harmless-network-failure" }]);
    try {
      const id = await normal(h), failed = await h.coordinator.run(id);
      expect(failed).toMatchObject({ status: "failed", outcomeCode: "uncertain", selectedUsefulness: null,
        spend: { physicalRequests: 4, unresolvedRequests: 1, outstandingNanoUsd: 1_344_000 } });
      await h.coordinator.recover(id); await h.coordinator.run(id);
      expect(h.remote.sent).toHaveLength(4);
      expect(failed.selected).not.toBeNull();
    } finally { await h.close(); }
  });
  it("records the existing usefulness owner authority without qualifying or promoting appropriateness", async () => {
    const h = await harness([]);
    try {
      const recorded = await recordApprovedUsefulnessPromotion(h.store), again = await recordApprovedUsefulnessPromotion(h.store);
      expect(again.id).toBe(recorded.id);
      expect(await h.store.currentPromotion(stage.fingerprint)).toBeNull();
      const live = createProductionCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, currentIntake: h.currentIntake, execution: { kind: "live", model: h.model } });
      await expect(live.create({ bundleId: h.bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000 })).rejects.toThrow("configuration_not_promoted");
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  });
  it("measures usefulness directly through the shared executor and never changes production selections", async () => {
    const h = await harness([...Array.from({ length: 3 }, () => usefulnessReply())]);
    const evaluationStore = await createPrivateStore({ ...h.options, datasetKey: h.keys.datasetKey });
    try {
      const evaluator = createDurableUsefulnessEvaluator({ store: evaluationStore, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ dataset: { name: "harmless", version: "a".repeat(64), split: "development",
        cases: [{ id: "harmless", headword: "emulate", partsOfSpeech: ["v"], expected: "keep", category: "keep" }] }, combiner: PRODUCTION_COMBINER, config, capNanoUsd: 100_000_000 });
      const measured = await evaluator.run(id);
      expect(measured.report.counts.truePositive).toBe(1);
      expect(measured.spend.physicalRequests).toBe(3);
      expect((await evaluator.run(id)).spend.physicalRequests).toBe(3);
      expect(await h.store.selectedProductionResult((await authorizeScopedCandidate(h.sources, h.bundleId, intake)).candidateId, "usefulness")).toBeNull();
      expect(h.remote.sent).toHaveLength(3);
      expect(h.remote.sent.map(r => JSON.parse(r.body))).toEqual(Array.from({ length: 3 }, () => createUsefulnessStage(usefulnessConfiguration(PRODUCTION_COMBINER)).render({ headword: "emulate", partsOfSpeech: ["v"] })));
    } finally { await evaluationStore.close(); await h.close(); }
  });
  it("preserves headword-only appropriateness across source selections but repeats usefulness without verified correspondence", async () => {
    const h = await harness([...Array.from({ length: 3 }, clear), ...Array.from({ length: 6 }, () => usefulnessReply())]);
    try {
      const first = await h.coordinator.run(await normal(h));
      const bundleId = fingerprint({ otherRelease: true, evidence });
      await h.sources.importBundle({ id: bundleId, intention: { otherRelease: true }, load: async () => evidence });
      await buildScopedCandidate(h.sources, bundleId, intake);
      const id = await h.coordinator.create({ bundleId, candidate: "emulate", intake, config, capNanoUsd: 100_000_000 });
      const changed = await h.coordinator.run(id);
      expect(changed.spend.physicalRequests).toBe(3);
      expect(changed.selected?.id).toBe(first.selected?.id);
      expect(changed.selectedUsefulness?.id).not.toBe(first.selectedUsefulness?.id);
      expect(h.remote.sent).toHaveLength(9);
    } finally { await h.close(); }
  });
  it("appends current intake authorization after a pause without rewriting the original gate dependencies", async () => {
    let block = true;
    const h = await harness([...Array.from({ length: 3 }, clear), ...Array.from({ length: 3 }, () => usefulnessReply())],
      { append: async type => { if (block && type === "request_outcome" && h.remote.sent.length === 4) throw new PrivateError("accounting_unavailable"); } });
    try {
      const id = await normal(h, true), paused = await h.coordinator.run(id);
      const changed = structuredClone(intake); changed.filters.frequency.ceiling = 3.6;
      const assessed = await buildScopedCandidate(h.sources, h.bundleId, changed);
      h.setIntake(changed); block = false;
      const resumed = await h.coordinator.run(id);
      expect(resumed.status).toBe("accepted");
      const authorizations = resumed.authorizations.filter(a => a.stage === "appropriateness");
      expect(authorizations).toHaveLength(2);
      expect(new Set(authorizations.map(a => a.assessment_id))).toEqual(new Set([paused.material.assessmentId, assessed.assessmentId]));
      expect(resumed.selectedUsefulness?.material).toMatchObject({ originalAssessmentId: paused.material.assessmentId });
      expect(resumed.authorizations.find(a => a.stage === "usefulness")).toMatchObject({ assessment_id: assessed.assessmentId });
      expect(h.remote.sent).toHaveLength(6);
    } finally { await h.close(); }
  });
  it.each(["invalid", "uncertain"])("stops direct evaluation on a new %s trial, then resumes remaining trials without replacing it", async kind => {
    const failed: ScriptedReply = kind === "invalid" ? { status: 200, body: "{invalid" } : { throws: "harmless-network-failure" };
    const h = await harness([failed, usefulnessReply(), usefulnessReply()]);
    const store = await createPrivateStore({ ...h.options, datasetKey: h.keys.datasetKey });
    try {
      const evaluator = createDurableUsefulnessEvaluator({ store, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ dataset: { name: "harmless", version: "a".repeat(64), split: "development",
        cases: [{ id: "harmless", headword: "emulate", partsOfSpeech: ["v"], expected: "keep", category: "keep" }] }, combiner: PRODUCTION_COMBINER, config, capNanoUsd: 100_000_000 });
      const first = await evaluator.run(id);
      expect(first.spend.physicalRequests).toBe(1);
      const resumed = await evaluator.run(id);
      expect(resumed.spend.physicalRequests).toBe(3);
      expect(resumed.outcomes[0].attempts.map(a => a?.status)).toEqual([kind, "valid", "valid"]);
      expect(resumed.rows[0].result).toBeNull();
      await evaluator.run(id);
      expect(h.remote.sent).toHaveLength(3);
      expect(resumed.outcomes[0].attempts[0]?.id).toBe(first.outcomes[0].attempts[0]?.id);
    } finally { await store.close(); await h.close(); }
  });
  it("terminalizes a saved evaluation reply without provider credentials before blocking the next new request", async () => {
    const h = await harness([usefulnessReply()]);
    let failFinish = true, keyAvailable = true;
    const store = await createPrivateStore({ ...h.options, datasetKey: h.keys.datasetKey,
      beforeWrite: async operation => { if (failFinish && operation === "finish_attempt") throw new PrivateError("storage_unavailable"); } });
    try {
      const evaluator = createDurableUsefulnessEvaluator({ store, ledger: h.ledger, model: h.model, sleep: async () => {},
        beforeDispatch: async () => { if (!keyAvailable) throw new PrivateError("model_key_required"); } });
      const id = await evaluator.create({ dataset: { name: "harmless", version: "a".repeat(64), split: "development",
        cases: [{ id: "harmless", headword: "emulate", partsOfSpeech: ["v"], expected: "keep", category: "keep" }] }, combiner: PRODUCTION_COMBINER, config, capNanoUsd: 100_000_000 });
      expect((await evaluator.run(id)).outcomes[0].attempts[0]?.status).toBe("pending");
      failFinish = false; keyAvailable = false;
      await expect(evaluator.run(id)).rejects.toThrow("model_key_required");
      const recovered = await evaluator.inspect(id);
      expect(recovered.outcomes[0].attempts[0]?.status).toBe("valid");
      expect(recovered.spend.physicalRequests).toBe(1);
      expect(h.remote.sent).toHaveLength(1);
    } finally { await store.close(); await h.close(); }
  });
});
