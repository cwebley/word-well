// @vitest-environment node
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturePool, harmlessKeys, privateTempDir, REPO, testDatabase } from "./testing/private-fixtures.js";
import { createPrivateStore } from "./storage/postgres.js";
import { createPlannerRevalidationStore } from "./storage/planner-revalidations.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { createPlannerStage, PLANNER_CONFIGURATION, plannerConfigurationSchema } from "./stages/planner.js";
import { plannerFixture, plannerPlan, plannerInlineBody } from "./testing/planner-fixtures.js";
import { LUNA_EXECUTION } from "./planner-config.js";
import { createPlannerEvaluator } from "../evals/planner.js";
import { freezePlannerDataset, loadPlannerDataset } from "../evals/datasets/planner.js";
import { createLunaAdapter } from "./execution/openrouter.js";
import { fingerprint } from "./config.js";
import { PLANNER_REVALIDATION_SCOPE, revalidatePlannerAnswers, requirePlannerRevalidation } from "./planner-revalidation.js";
import { recordPlannerReview, recordPlannerDecision, requirePlannerPromotion } from "./planner-promotion.js";

describe.skipIf(!process.env.DATABASE_URL)("append-only planner revalidation in restricted disposable databases", () => {
  async function harness() {
    const database = await testDatabase(), keys = await harmlessKeys(), temp = await privateTempDir();
    const options = { connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto };
    const store = await createPrivateStore({ ...options, datasetKey: keys.datasetKey });
    const proofs = await createPlannerRevalidationStore(options);
    const admin = fixturePool(database.adminUrl), learner = fixturePool(database.learnerUrl);
    const ledger = await createReceiptLedger({ directory: resolve(temp.root, "ledger"), checkout: REPO });
    const configuration = plannerConfigurationSchema.parse({ ...PLANNER_CONFIGURATION, routingVerification: "completion-inline-strict-v1" });
    const stage = createPlannerStage(configuration, plannerFixture), experimentId = PLANNER_REVALIDATION_SCOPE.sourceExperimentId;
    const frozen = await freezePlannerDataset({ directory: resolve(temp.root, "datasets"), checkout: REPO, version: 3, key: keys.datasetKey, crypto: keys.crypto,
      cases: [{ id: randomUUID(), input: plannerFixture, split: "development", expectation: { requiredDefiningGroups: [["s1"]], allowedUsageNoteRefs: ["s2"], allowedOmissionRefs: [], semanticCriteria: ["Harmless controlled criteria."] },
        approval: { reviewer: "local-owner", approvedAt: new Date().toISOString(), reference: "Controlled approval.", answersInspected: false } }] });
    const loaded = await loadPlannerDataset(frozen.directory, keys.crypto), caseId = loaded.dataset.cases[0].id;
    await store.createExperiment({ id: experimentId, stage: "planner", dataset: { id: loaded.dataset.id, version: 3, ciphertextSha256: loaded.manifest.ciphertextSha256 },
      configurationFingerprint: stage.fingerprint, implementationFingerprint: PLANNER_REVALIDATION_SCOPE.sourceImplementation, capNanoUsd: 1230000000,
      material: { schema: "wordwell-planner-evaluation-v1", configuration, execution: LUNA_EXECUTION, implementation: PLANNER_REVALIDATION_SCOPE.sourceImplementation,
        testedRuleIdentity: PLANNER_REVALIDATION_SCOPE.sourceRuleIdentity, datasetContentIdentity: loaded.dataset.contentIdentity },
      stageCases: [{ caseId, position: 0, input: plannerFixture, expectation: { expectation: loaded.dataset.cases[0].expectation, split: "development", approval: loaded.dataset.cases[0].approval } }] });
    for (let index = 1; index <= 3; index++) {
      const attemptId = randomUUID(), requestId = randomUUID(), generationId = `gen-harmless-revalidation-${index}`, at = new Date();
      await store.trialAttempt(experimentId, caseId, index, attemptId);
      await store.createAttempt({ id: attemptId, experimentId, stage: "planner", input: { input: plannerFixture, request: stage.render(plannerFixture) } });
      await store.reserveRequest({ experimentId, attemptId, requestId, sequence: 1, reservedNanoUsd: 397600000, at });
      await ledger.append({ type: "dispatch_intent", eventId: randomUUID(), at: at.toISOString(), experimentId, attemptId, requestId, sequence: 1, reservedNanoUsd: 397600000 });
      const response = { kind: "response" as const, status: 200, body: plannerInlineBody(plannerPlan, { id: generationId }, { attempts: undefined }), contentType: "application/json", retryAfter: null };
      await store.recordOutcome(requestId, { status: "responded", httpStatus: 200, retryable: false, retryAfterMs: null, generationId, inputTokens: 900, outputTokens: 200,
        chargeNanoUsd: 420000, completedAt: at, response });
      await ledger.append({ type: "request_outcome", eventId: randomUUID(), at: at.toISOString(), experimentId, attemptId, requestId, outcome: "responded", httpStatus: 200,
        generationId, inputTokens: 900, outputTokens: 200, chargeStatus: "known", chargeNanoUsd: 420000 });
      await store.finishAttempt(attemptId, { status: "verification_unresolved", outcomeCode: "luna_verification_unresolved" });
    }
    const originalIdentity = await proofs.sourceEvidenceIdentity(experimentId);
    // Synthetic ciphertext cannot equal the pinned live snapshot. Map only this
    // fixture's initial snapshot; any later source change returns its real hash.
    const sourceIdentity = proofs.sourceEvidenceIdentity;
    proofs.sourceEvidenceIdentity = async id => {
      const identity = await sourceIdentity(id);
      return identity === originalIdentity ? PLANNER_REVALIDATION_SCOPE.sourceEvidenceIdentity : identity;
    };
    const approval = { reviewer: "local-owner", reference: PLANNER_REVALIDATION_SCOPE.approvalReference, sourceExperimentId: experimentId, decision: "reuse-saved-answers", modelCalls: 0 };
    let sends = 0;
    const evaluator = createPlannerEvaluator({ store, ledger, model: createLunaAdapter({ fetch: async () => { sends++; throw new Error("network_forbidden"); } }) });
    const revalidate = () => revalidatePlannerAnswers({ store, revalidations: proofs, ledger, approval });
    return { store, proofs, admin, learner, evaluator, revalidate, approval, experimentId, ledger, get sends() { return sends; },
      close: async () => { await Promise.all([store.close(), proofs.close(), admin.end(), learner.end()]); await database.drop(); await temp.cleanup(); } };
  }

  it("reuses the exact paid evidence idempotently without changing its outcomes, ciphertexts or ledger", async () => {
    const h = await harness();
    try {
      const original = await h.evaluator.inspect(h.experimentId), receipts = await h.ledger.read();
      const ciphertexts = (await h.admin.query("SELECT response_payload FROM private.requests ORDER BY id")).rows;
      const [proof, concurrent] = await Promise.all([h.revalidate(), h.revalidate()]);
      expect(concurrent).toEqual(proof);
      expect(proof.trials.map(trial => trial.result)).toEqual([plannerPlan, plannerPlan, plannerPlan]);
      expect(proof.trials.every(trial => trial.coveragePassed)).toBe(true);
      expect((await h.admin.query("SELECT count(*)::int AS count FROM private.planner_revalidations")).rows[0].count).toBe(1);
      const ciphertext = (await h.admin.query("SELECT payload FROM private.planner_revalidations")).rows[0].payload;
      expect(await h.revalidate()).toEqual(proof);
      expect((await h.admin.query("SELECT payload FROM private.planner_revalidations")).rows[0].payload).toEqual(ciphertext);
      expect(await h.evaluator.inspect(h.experimentId)).toEqual(original);
      expect((await h.admin.query("SELECT response_payload FROM private.requests ORDER BY id")).rows).toEqual(ciphertexts);
      expect(await h.ledger.read()).toEqual(receipts);
      expect(h.sends).toBe(0);
      await expect(h.admin.query("UPDATE private.planner_revalidations SET rule_identity=$1", ["f".repeat(64)])).rejects.toThrow();
      await expect(h.admin.query("DELETE FROM private.planner_revalidations")).rejects.toThrow();
      await expect(h.learner.query("SELECT * FROM private.planner_revalidations")).rejects.toMatchObject({ code: "42501" });
    } finally { await h.close(); }
  }, 30000);

  it("requires exact owner reviews before promotion and keeps the original experiment unaccepted", async () => {
    const h = await harness();
    try {
      const proof = await h.revalidate();
      const decision = { experimentId: h.experimentId, revalidationId: proof.id, decision: "promote" as const, reference: "Controlled decision." };
      await expect(recordPlannerDecision(h.store, h.evaluator, decision, h.proofs)).rejects.toThrow("planner_review_not_passing");
      const review = (index: number) => ({ schema: "wordwell-planner-trial-review-v2", reviewer: "local-owner", experimentId: h.experimentId,
        revalidationId: proof.id, attemptId: proof.trials[index].attemptId, resultFingerprint: proof.trials[index].resultFingerprint,
        factualityPassed: true, groundingPassed: true, coveragePassed: true, quality: 1, findings: ["Controlled quality score has no threshold."], reference: "Controlled review." });
      const { revalidationId, ...first } = review(0);
      expect(revalidationId).toBe(proof.id);
      await expect(recordPlannerReview(h.store, h.evaluator, { ...first, schema: "wordwell-planner-trial-review-v1" })).rejects.toThrow("planner_review_evidence_invalid");
      await expect(recordPlannerReview(h.store, h.evaluator, { ...review(0), resultFingerprint: "a".repeat(64) }, h.proofs)).rejects.toThrow("planner_review_evidence_invalid");
      for (let index = 0; index < 2; index++) await recordPlannerReview(h.store, h.evaluator, review(index), h.proofs);
      await expect(recordPlannerDecision(h.store, h.evaluator, decision, h.proofs)).rejects.toThrow("planner_review_not_passing");
      await recordPlannerReview(h.store, h.evaluator, { ...review(2), groundingPassed: false }, h.proofs);
      await expect(recordPlannerDecision(h.store, h.evaluator, decision, h.proofs)).rejects.toThrow("planner_review_not_passing");
      await recordPlannerReview(h.store, h.evaluator, review(2), h.proofs);
      expect(await recordPlannerDecision(h.store, h.evaluator, decision, h.proofs)).toMatchObject({ decision: "promote", modelCalls: 0 });
      await expect(requirePlannerPromotion(h.store, proof.configurationFingerprint)).rejects.toThrow("planner_revalidation_missing");
      expect((await requirePlannerPromotion(h.store, proof.configurationFingerprint, h.proofs)).decision).toBe("promote");
      expect((await h.evaluator.inspect(h.experimentId)).summary).toMatchObject({ validTrials: 0, verificationUnresolvedTrials: 3 });
      await recordPlannerDecision(h.store, h.evaluator, { ...decision, decision: "do_not_promote" }, h.proofs);
      await expect(requirePlannerPromotion(h.store, proof.configurationFingerprint, h.proofs)).rejects.toThrow("planner_configuration_not_promoted");
      expect(h.sends).toBe(0);
    } finally { await h.close(); }
  }, 30000);

  it("rejects changed source evidence and forged or stale interpretations", async () => {
    const h = await harness();
    try {
      const proof = await h.revalidate();
      const material = { ...proof, implementation: "a".repeat(64) }, { id, ...body } = material;
      expect(id).toBe(proof.id);
      const stale = { ...material, id: fingerprint(body) };
      await h.proofs.save({ id: stale.id, sourceExperimentId: stale.sourceExperimentId, configurationFingerprint: stale.configurationFingerprint,
        implementation: stale.implementation, ruleIdentity: stale.testedRuleIdentity, sourceEvidenceIdentity: stale.sourceEvidenceIdentity, material: stale });
      await expect(requirePlannerRevalidation(h.store, h.proofs, stale.id)).rejects.toThrow("planner_revalidation_stale");
      await expect(revalidatePlannerAnswers({ store: h.store, revalidations: h.proofs, ledger: h.ledger, approval: { ...h.approval, sourceExperimentId: randomUUID() } })).rejects.toThrow();
      await h.admin.query("UPDATE private.requests SET charge_nano_usd=charge_nano_usd+1 WHERE id=$1", [proof.trials[0].requestId]);
      await expect(requirePlannerRevalidation(h.store, h.proofs, proof.id)).rejects.toThrow("planner_revalidation_stale");
      await expect(h.revalidate()).rejects.toThrow("planner_revalidation_source_changed");
      expect(h.sends).toBe(0);
    } finally { await h.close(); }
  }, 30000);
});
