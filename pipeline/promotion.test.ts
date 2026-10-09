// @vitest-environment node
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assessSavedPromotion, recordOwnerPromotion, requirePromotion } from "./promotion.js";
import { requireGatePromotion, revalidateSavedGatePromotion } from "./gate-promotion-compatibility.js";
import { fingerprint } from "./config.js";
import { createPrivateStore } from "./storage/postgres.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { createSystemOneAdapter } from "./execution/system-one.js";
import { createPrivateAppropriatenessRunner, loadLocalConfig, implementationIdentity } from "../evals/private-appropriateness.js";
import { frozenDataset } from "../evals/private-fixtures.js";
import { APPROPRIATENESS_CONFIGURATION, createAppropriatenessStage } from "./stages/appropriateness.js";
import { fixturePool, jevReply, scriptedFetch, testDatabase, REPO } from "./testing/private-fixtures.js";

const config = loadLocalConfig(JSON.parse(await readFile(resolve(REPO, "config/private-appropriateness.json"), "utf8")));
describe.skipIf(!process.env.DATABASE_URL)("versioned saved-evidence promotion", () => {
  it("carries only the approved rule transition across exact historical evidence, without replacing the owner's decision", async () => {
    const database = await testDatabase(), d = await frozenDataset([{ headword: "harmless-clear-standin", finding: "clear", split: "held-out" }]);
    const options = { connectionString: database.pipelineUrl, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto: d.f.crypto };
    const store = await createPrivateStore(options), admin = fixturePool(database.adminUrl);
    const ledger = await createReceiptLedger({ directory: resolve(d.f.root, "ledger"), checkout: REPO });
    const remote = scriptedFetch(Array.from({ length: 3 }, () => jevReply("clear", 0.1, {}, 0.1)));
    const runner = createPrivateAppropriatenessRunner({ store, ledger, models: { "openrouter-systemone-v1": createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch }) },
      implementation: { ...await implementationIdentity(), fingerprint: "1266db030c7ca52515a000b1d5b9b65ad1b4c8c63dc4286fedd87aa78585d0b2" } });
    try {
      const experimentId = await runner.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto, capNanoUsd: 1_000_000_000,
        configuration: APPROPRIATENESS_CONFIGURATION, config, split: "held-out" });
      await runner.run(experimentId);
      await runner.finalize(experimentId, { summariesDir: resolve(d.f.root, "summaries") });
      // The original store predates request_verifications. Retain its exact view
      // for this historical fixture, without changing any attempt or response.
      const historicalStore = { ...store, readAttempt: async (id: string) => {
        const attempt = await store.readAttempt(id);
        return attempt && { ...attempt, requests: attempt.requests.map(({ verifications: _empty, ...request }) => request) };
      } };
      const assessed = await assessSavedPromotion({ store: historicalStore, datasetDir: d.datasetDir, manifest: d.manifest, crypto: d.f.crypto, experimentId });
      const original = { ...assessed, ruleIdentity: "c1c53e7f137fe21bed9d6b4c537303d00f6c2ec7b51508244b8e69a386066b37" };
      original.id = fingerprint({ ruleIdentity: original.ruleIdentity, evidenceIdentity: original.evidenceIdentity });
      await store.savePromotionAssessment({ ...original, material: original });
      const owner = { schema: "wordwell-owner-stage-promotion-v1", reviewer: "local-owner", issue: "https://github.com/cwebley/word-well/issues/17",
        decisionReference: "https://github.com/cwebley/word-well/issues/17#issuecomment-1", assessmentId: original.id, decision: "promote" as const };
      const promotionId = "f29675ef-4c9b-43d6-99ea-3eece045a943";
      await store.recordPromotion({ id: promotionId, assessmentId: original.id, configurationFingerprint: original.configurationFingerprint, decision: "promote", material: owner });
      const before = await store.readPromotionAssessment(original.id), receipts = await ledger.read();
      await expect(requireGatePromotion(store, original.configurationFingerprint)).rejects.toThrow("promotion_evidence_invalid");
      const revalidate = () => revalidateSavedGatePromotion({ store, datasetDir: d.datasetDir, manifest: d.manifest, crypto: d.f.crypto, configurationFingerprint: original.configurationFingerprint });
      const proof = await revalidate();
      expect(proof).toMatchObject({ kind: "promotion", subjectId: promotionId, originalAssessmentId: original.id, originalIdentity: original.ruleIdentity, modelCalls: 0 });
      expect(await revalidate()).toEqual(proof);
      const restarted = await createPrivateStore(options);
      try { expect((await requireGatePromotion(restarted, original.configurationFingerprint)).id).toBe(promotionId); }
      finally { await restarted.close(); }
      expect(await store.readPromotionAssessment(original.id)).toEqual(before);
      expect(await store.currentPromotion(original.configurationFingerprint)).toMatchObject({ id: promotionId, material: owner });
      expect(await ledger.read()).toEqual(receipts);
      expect(remote.sent).toHaveLength(3);
      await expect(admin.query("UPDATE private.gate_compatibilities SET current_identity=$1 WHERE id=$2", ["0".repeat(64), proof.id])).rejects.toMatchObject({ code: "55000" });
      const learner = fixturePool(database.learnerUrl);
      try { await expect(learner.query("SELECT * FROM private.gate_compatibilities")).rejects.toMatchObject({ code: "42501" }); }
      finally { await learner.end(); }
      // Same scores do not authorize an unknown rule or a different evidence
      // identity. Both must fail before a compatibility proof can be appended.
      for (const change of [{ ruleIdentity: "0".repeat(64) }, { evidenceIdentity: "1".repeat(64) }, { originalSummarySha256: "2".repeat(64) }]) {
        const altered = { ...original, ...change };
        if ("originalSummarySha256" in change) altered.evidenceIdentity = "3".repeat(64);
        altered.id = fingerprint({ ruleIdentity: altered.ruleIdentity, evidenceIdentity: altered.evidenceIdentity });
        await store.savePromotionAssessment({ ...altered, material: altered });
        await store.recordPromotion({ id: randomUUID(), assessmentId: altered.id, configurationFingerprint: original.configurationFingerprint,
          decision: "promote", material: { ...owner, assessmentId: altered.id } });
        await expect(requireGatePromotion(store, original.configurationFingerprint)).rejects.toThrow("promotion_evidence_invalid");
        await expect(revalidate()).rejects.toThrow("promotion_evidence_invalid");
      }
      await store.recordPromotion({ id: randomUUID(), assessmentId: original.id, configurationFingerprint: original.configurationFingerprint, decision: "promote", material: owner });
      await revalidate();
      expect((await requireGatePromotion(store, original.configurationFingerprint)).decision).toBe("promote");
      // A new reservation can be appended through the public storage interface
      // even after finalization. A prior snapshot must not authorize changed
      // evidence, and checking its integrity must not need the dataset key.
      const trial = (await store.listTrials(experimentId))[0];
      await store.reserveRequest({ requestId: randomUUID(), experimentId, attemptId: trial.attemptId, sequence: 2, reservedNanoUsd: 1, at: new Date() });
      const productionStore = await createPrivateStore({ ...options, datasetKey: undefined });
      try { await expect(requireGatePromotion(productionStore, original.configurationFingerprint)).rejects.toThrow("promotion_evidence_invalid"); }
      finally { await productionStore.close(); }
      expect(remote.sent).toHaveLength(3);
      await store.recordPromotion({ id: "494f8d72-c5db-4878-8c1e-d95f7c097c28", assessmentId: original.id, configurationFingerprint: original.configurationFingerprint,
        decision: "do_not_promote", material: { ...owner, decision: "do_not_promote" } });
      await expect(requireGatePromotion(store, original.configurationFingerprint)).rejects.toThrow("configuration_not_promoted");
      await expect(revalidate()).rejects.toThrow("configuration_not_promoted");
    } finally { await Promise.all([store.close(), admin.end()]); await database.drop(); await d.f.cleanup(); }
  }, 30_000);
  it("counts averaged accuracy, reports both error directions and development misses, and preserves finalized evidence", async () => {
    const database = await testDatabase();
    const d = await frozenDataset([
      { headword: "harmless-blocked-standin", finding: "blocked", split: "held-out" },
      ...Array.from({ length: 20 }, (_, i) => ({ headword: `harmless-clear-standin-${i}`, finding: "clear" as const, split: "held-out" as const })),
      { headword: "harmless-development-standin", finding: "blocked", split: "development" }
    ]);
    const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto: d.f.crypto });
    const ledger = await createReceiptLedger({ directory: resolve(d.f.root, "ledger"), checkout: REPO });
    const heldOutWords = d.order.filter(h => h !== "harmless-development-standin");
    const script = heldOutWords.flatMap(h => h === "harmless-blocked-standin"
      ? [jevReply("clear", 0.49, {}, 0.1), jevReply("clear", 0.49, {}, 0.1), jevReply("blocked", 0.99, {}, 0.1)]
      : Array.from({ length: 3 }, () => jevReply(h === "harmless-clear-standin-19" ? "blocked" : "clear", h === "harmless-clear-standin-19" ? 0.9 : 0.1, {}, 0.1)));
    const remote = scriptedFetch([...script, ...Array.from({ length: 3 }, () => jevReply("clear", 0.1, {}, 0.1))]);
    const runner = createPrivateAppropriatenessRunner({ store, ledger, models: { "openrouter-systemone-v1": createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch }) }, implementation: await implementationIdentity(), sleep: async () => {} });
    const create = (split: "held-out" | "development") => runner.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto,
      capNanoUsd: 1_000_000_000, configuration: APPROPRIATENESS_CONFIGURATION, config, split });
    const admin = fixturePool(database.adminUrl);
    try {
      const experimentId = await create("held-out");
      const oldResult = await runner.run(experimentId);
      expect(oldResult.summary.goldenRequirementsPass).toBe(false);
      const oldFinal = await runner.finalize(experimentId, { summariesDir: resolve(d.f.root, "summaries") });
      const oldFile = await readFile(oldFinal.path);
      const developmentId = await create("development");
      await runner.run(developmentId);
      const snapshot = async () => (await admin.query("SELECT md5(string_agg(row_to_json(t)::text,E'\n' ORDER BY row_to_json(t)::text)) AS digest FROM (SELECT row_to_json(e)::text AS value FROM private.experiments e UNION ALL SELECT row_to_json(a)::text FROM private.attempts a UNION ALL SELECT row_to_json(r)::text FROM private.requests r UNION ALL SELECT row_to_json(s)::text FROM private.case_scores s) t")).rows[0].digest;
      const before = await snapshot();
      const assessment = await assessSavedPromotion({ store, datasetDir: d.datasetDir, manifest: d.manifest, crypto: d.f.crypto, experimentId });
      expect(assessment).toMatchObject({ qualifies: true, modelCalls: 0, heldOut: { cases: 21, correctAverages: 20, requiredTrials: 63, validTrials: 63,
        wrongAccepts: 0, wrongRejects: 1, individualWrongAccepts: 2, individualWrongRejects: 3, unstableCases: 1 },
        development: [{ experimentId: developmentId, counts: { cases: 1, correctAverages: 0, wrongAccepts: 1 } }] });
      expect(assessment.accuracy).toBe(20 / 21);
      expect(remote.sent).toHaveLength(66);
      expect(await assessSavedPromotion({ store, datasetDir: d.datasetDir, manifest: d.manifest, crypto: d.f.crypto, experimentId })).toEqual(assessment);
      expect(await snapshot()).toBe(before);
      expect(await readFile(oldFinal.path)).toEqual(oldFile);
      expect((await runner.finalize(experimentId, { summariesDir: resolve(d.f.root, "summaries") })).sha256).toBe(oldFinal.sha256);
      expect(remote.sent).toHaveLength(66);
      const configurationFingerprint = createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION).fingerprint;
      await expect(requirePromotion(store, configurationFingerprint)).rejects.toThrow("configuration_not_promoted");
      const owner = { schema: "wordwell-owner-stage-promotion-v1", reviewer: "local-owner", issue: "https://github.com/cwebley/word-well/issues/17",
        decisionReference: "https://github.com/cwebley/word-well/issues/17#issuecomment-1", assessmentId: assessment.id, decision: "promote" };
      await expect(recordOwnerPromotion(store, { ...owner, reviewer: "automatic" })).rejects.toThrow("owner_decision_invalid");
      const promoted = await recordOwnerPromotion(store, owner);
      expect((await requirePromotion(store, configurationFingerprint)).id).toBe(promoted.id);
      await expect(requirePromotion(store, "0".repeat(64))).rejects.toThrow("configuration_not_promoted");
      await recordOwnerPromotion(store, { ...owner, decision: "do_not_promote" });
      await expect(requirePromotion(store, configurationFingerprint)).rejects.toThrow("configuration_not_promoted");
      await expect(admin.query("UPDATE private.promotion_assessments SET qualifies=false WHERE id=$1", [assessment.id])).rejects.toMatchObject({ code: "55000" });
      const payload = (await admin.query("SELECT payload FROM private.promotion_assessments WHERE id=$1", [assessment.id])).rows[0].payload;
      expect(payload.toString()).not.toContain("harmless");
      await expect(store.savePromotionAssessment({ ...assessment, material: { ...assessment, qualifies: false } })).rejects.toThrow("assessment_identity_conflict");
      expect(JSON.stringify(assessment)).not.toMatch(/harmless|headword|reason|request|response/);
      expect((await admin.query("SELECT count(*) AS count FROM private.production_results")).rows[0].count).toBe("0");
      const mixedRemote = scriptedFetch(d.order.flatMap(() => Array.from({ length: 3 }, () => jevReply("clear", 0.1, {}, 0.1))));
      const mixedRunner = createPrivateAppropriatenessRunner({ store, ledger, models: { "openrouter-systemone-v1": createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: mixedRemote.fetch }) }, implementation: await implementationIdentity() });
      const mixedId = await mixedRunner.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto, capNanoUsd: 1_000_000_000, configuration: APPROPRIATENESS_CONFIGURATION, config });
      await mixedRunner.run(mixedId);
      await mixedRunner.finalize(mixedId, { summariesDir: resolve(d.f.root, "summaries") });
      const mixedAssessment = await assessSavedPromotion({ store, datasetDir: d.datasetDir, manifest: d.manifest, crypto: d.f.crypto, experimentId: mixedId });
      expect(mixedAssessment).toMatchObject({ qualifies: true, heldOut: { cases: 21, correctAverages: 20, wrongAccepts: 1, wrongRejects: 0 } });
      expect(mixedAssessment.development).toEqual(expect.arrayContaining([expect.objectContaining({ experimentId: mixedId, counts: expect.objectContaining({ cases: 1, wrongAccepts: 1 }) })]));
      expect(mixedRemote.sent).toHaveLength(66);
    } finally { await Promise.all([store.close(), admin.end()]); await database.drop(); await d.f.cleanup(); }
  }, 30_000);
  it("cannot qualify failed, missing or non-held-out work and refuses unfinalized or smoke evidence", async () => {
    const database = await testDatabase();
    const d = await frozenDataset([{ headword: "exuberant", finding: "clear", split: "held-out" }]);
    const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: d.f.storageKey, datasetKey: d.f.datasetKey, crypto: d.f.crypto });
    const ledger = await createReceiptLedger({ directory: resolve(d.f.root, "ledger"), checkout: REPO });
    const remote = scriptedFetch([jevReply("clear", 0.1, {}, 0.1), { status: 200, body: "{harmless-bad-reply" }]);
    const runner = createPrivateAppropriatenessRunner({ store, ledger, models: { "openrouter-systemone-v1": createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: remote.fetch }) }, implementation: await implementationIdentity(), sleep: async () => {} });
    const create = (purpose: "evaluation" | "smoke" = "evaluation") => runner.create({ datasetDir: d.datasetDir, manifest: d.manifest, datasetCrypto: d.f.crypto, capNanoUsd: 1_000_000_000, configuration: APPROPRIATENESS_CONFIGURATION, config, split: "held-out", purpose });
    const assess = (experimentId: string) => assessSavedPromotion({ store, datasetDir: d.datasetDir, manifest: d.manifest, crypto: d.f.crypto, experimentId });
    try {
      const id = await create();
      await expect(assess(id)).rejects.toThrow("finalized_evidence_required");
      await runner.run(id);
      await runner.finalize(id, { summariesDir: resolve(d.f.root, "summaries") });
      const assessment = await assess(id);
      expect(assessment).toMatchObject({ qualifies: false, heldOut: { cases: 1, requiredTrials: 3, validTrials: 1, correctAverages: 0 } });
      await expect(recordOwnerPromotion(store, { schema: "wordwell-owner-stage-promotion-v1", reviewer: "local-owner", issue: "https://github.com/cwebley/word-well/issues/17",
        decisionReference: "https://github.com/cwebley/word-well/issues/17#issuecomment-1", assessmentId: assessment.id, decision: "promote" })).rejects.toThrow("promotion_evidence_invalid");
      const smoke = await create("smoke");
      await runner.finalize(smoke, { summariesDir: resolve(d.f.root, "summaries") });
      await expect(assess(smoke)).rejects.toThrow("heldout_evaluation_required");
      const missing = await create();
      await runner.finalize(missing, { summariesDir: resolve(d.f.root, "summaries") });
      expect(await assess(missing)).toMatchObject({ qualifies: false, heldOut: { validTrials: 0 } });
      expect(remote.sent).toHaveLength(2);
    } finally { await store.close(); await database.drop(); await d.f.cleanup(); }
  });
});
