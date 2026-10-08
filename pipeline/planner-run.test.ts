// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { fixturePool, harmlessKeys, privateTempDir, REPO, scriptedFetch, testDatabase, type ScriptedReply } from "./testing/private-fixtures.js";
import { createPrivateStore } from "./storage/postgres.js";
import { createSourceStore } from "./storage/sources.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { createLunaAdapter } from "./execution/openrouter.js";
import { createPlannerCoordinator } from "./planner-run.js";
import { PLANNER_CONFIGURATION, createPlannerStage } from "./stages/planner.js";
import { plannerEvidence } from "./sources/planner.js";
import { createPlannerEvaluator } from "../evals/planner.js";
import { freezePlannerDataset, loadPlannerDataset } from "../evals/datasets/planner.js";
import { recordPlannerDecision, recordPlannerReview, requirePlannerPromotion } from "./planner-promotion.js";
import { fingerprint, loadPipelineConfig } from "./config.js";
import { plannerFixture, plannerPlan, plannerReply, plannerInlineMetadata } from "./testing/planner-fixtures.js";
import { bundleSchema } from "./sources/bundle.js";
import { PrivateError } from "./storage/crypto.js";
import { createStageExecutor } from "./execution/executor.js";
import { LUNA_EXECUTION, lunaExecutionSettings } from "./planner-config.js";
import { latestResponse } from "./storage/postgres.js";

describe.skipIf(!process.env.DATABASE_URL)("durable planner paths in restricted disposable databases", () => {
  async function harness(script: ScriptedReply[], faults: { write?: (operation: string) => Promise<void>; append?: (type: string) => Promise<void>; beforeDispatch?: () => Promise<void> } = {}) {
    const database = await testDatabase(), keys = await harmlessKeys(), temp = await privateTempDir();
    const store = await createPrivateStore({ connectionString: database.pipelineUrl, storageKey: keys.storageKey, datasetKey: keys.datasetKey, crypto: keys.crypto, beforeWrite: faults.write });
    const sources = await createSourceStore({ connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto });
    const admin = fixturePool(database.adminUrl), learner = fixturePool(database.learnerUrl);
    // Synthetic evidence and controlled gate stand-ins exercise planner ownership.
    // Actual gate validation remains the existing run suite and development dry-run.
    const evidence = bundleSchema.parse({ scope: { controlled: true }, artifacts: [], entries: [
      { source: "oewn", id: "entry-fixture", headword: "evanescent", pos: "a", order: 1, role: "candidate", raw: "harmless-source", rawSha256: "a".repeat(64), locator: {}, data: { forms: [] } }
    ], meanings: [{ source: "oewn", entryId: "entry-fixture", id: "meaning-fixture", order: 1, conceptId: "concept-fixture", relations: [], data: { definition: "A harmless adjective fixture.", examples: [] } }], concepts: [], relations: [],
      frequency: { order: 1, form: "evanescent", tokens: ["evanescent"], storedFrequency: 1e-7, directZipf: 2 }, supplemental: { page_id: "1", revision_id: "1", text_sha256: "a".repeat(64), raw_wikitext: "harmless-source", authenticatesKaikki: false, meanings: [] },
      diagnostics: [], coverage: { candidates: ["evanescent"], fullCorpus: false, oewnMeanings: 1, kaikkiMeanings: 6 }, modelCalls: 0 });
    const bundleId = fingerprint(evidence);
    await sources.importBundle({ id: bundleId, intention: { controlled: true }, load: async () => evidence });
    const assessed = await sources.assess({ bundleId, headword: "evanescent", configFingerprint: "a".repeat(64), resolution: { controlled: true }, assessment: { disposition: "pass" } });
    const gateRun = randomUUID();
    await store.createProductionRun({ id: gateRun, candidateId: assessed.candidateId, capNanoUsd: 1, material: { controlledGateStandins: true } });
    const approprId = randomUUID(), usefulId = randomUUID();
    for (const [stage, id] of [["appropriateness", approprId], ["usefulness", usefulId]]) {
      const claim = await store.claimCandidate(assessed.candidateId, gateRun, true);
      try { await store.completeProduction(claim, { stage, status: "accepted", result: { id, reuseIdentity: "a".repeat(64), material: { controlledGateStandin: true } }, continuing: stage === "appropriateness" }); }
      finally { await claim.release(); }
    }
    const remote = scriptedFetch(script), model = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch });
    const ledger = await createReceiptLedger({ directory: resolve(temp.root, "ledger"), checkout: REPO, beforeAppend: faults.append });
    const config = await loadPipelineConfig("config/pipeline.yaml");
    let permission = true;
    const coordinator = createPlannerCoordinator({ store, sources, ledger, model, executionKind: "controlled", currentIntake: async () => config,
      authorizeGates: async selected => {
        if (!permission || selected !== bundleId) throw new PrivateError("usefulness_not_accepted");
        return { candidateId: assessed.candidateId, headword: "evanescent", bundleId, assessmentId: assessed.assessmentId, appropriatenessResultId: approprId, resultId: usefulId };
      }, sleep: async () => {}, beforeDispatch: faults.beforeDispatch });
    const create = (fresh = false, configuration = PLANNER_CONFIGURATION) => coordinator.create({ bundleId, candidate: "evanescent", configuration, capNanoUsd: 2e9, fresh });
    return { store, sources, keys, temp, admin, learner, remote, model, ledger, coordinator, create, bundleId, input: plannerEvidence(bundleId, evidence), setPermission: (value: boolean) => { permission = value; },
      close: async () => { await Promise.all([store.close(), sources.close(), admin.end(), learner.end()]); await database.drop(); await temp.cleanup(); } };
  }
  const onePlan = { meanings: [{ definition: "A harmless adjective fixture.", part_of_speech: "adjective", sense_ids: ["s1"], usage_note_sense_ids: [], synonyms: [] }], word_family: [], omitted_source_meanings: [] };
  const reply = () => ({ status: 200, body: plannerReply(onePlan), headers: { "content-type": "application/json" } });
  it("retains a charged unresolved completion and never reopens or replaces it", async () => {
    const h = await harness([{ ...reply(), body: plannerReply(onePlan, { openrouter_metadata: undefined }) }]);
    try {
      const id = await h.create();
      const first = await h.coordinator.run(id);
      expect(first).toMatchObject({ status: "failed", outcomeCode: "luna_verification_unresolved", selected: null,
        spend: { physicalRequests: 1, knownNanoUsd: 420000, outstandingNanoUsd: 0 } });
      expect(first.trials[0].attempt?.status).toBe("verification_unresolved");
      const original = (await h.admin.query("SELECT response_payload FROM private.requests WHERE attempt_id=$1", [first.trials[0].attemptId])).rows[0].response_payload;
      h.model.send = async () => { throw new Error("replacement_generation_forbidden"); };
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "failed", outcomeCode: "luna_verification_unresolved" });
      const final = await h.coordinator.run(id);
      expect(final).toMatchObject({ status: "failed", claimOwnerRunId: null, spend: { physicalRequests: 1, knownNanoUsd: 420000, outstandingNanoUsd: 0 } });
      expect(h.remote.sent).toHaveLength(1);
      expect((await h.admin.query("SELECT response_payload FROM private.requests WHERE attempt_id=$1", [first.trials[0].attemptId])).rows[0].response_payload).toEqual(original);
      expect((await h.admin.query("SELECT count(*)::int AS count FROM private.request_verifications")).rows[0].count).toBe(0);
      await expect(h.learner.query("SELECT * FROM private.request_verifications")).rejects.toMatchObject({ code: "42501" });
      const request = first.trials[0].attempt!.requests[0];
      await expect(h.store.saveRequestVerification({ id: randomUUID(), requestId: request.id, sequence: 1, response: request.response! })).rejects.toThrow("verification_conflict");
    } finally { await h.close(); }
  }, 30000);
  it.each(["wrong_model", "wrong_provider", "cached", "wrong_generation"])("fails verified %s evidence without a replacement generation", async kind => {
    const changed = kind === "wrong_model" ? { model: "openai/wrong-model" } : kind === "wrong_provider" ? { provider: "Azure" } : {};
    const headers: Record<string, string> = kind === "cached" ? { "x-openrouter-cache-status": "HIT" } : kind === "wrong_generation" ? { "x-generation-id": "gen-unrelated" } : {};
    const h = await harness([{ ...reply(), body: plannerReply(onePlan, changed), headers: { ...reply().headers, ...headers } }]);
    try {
      const id = await h.create();
      expect((await h.coordinator.run(id)).status).toBe("failed");
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "failed", outcomeCode: "luna_routing_unverified", claimOwnerRunId: null });
      expect((await h.coordinator.recover(id)).status).toBe("failed");
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it("finishes other serial evaluation trials after unresolved proof and preserves every outcome on restart", async () => {
    const h = await harness([{ ...reply(), body: plannerReply(onePlan, { openrouter_metadata: plannerInlineMetadata({ attempts: undefined }) }) }, reply(), reply()]);
    try {
      const frozen = await freezePlannerDataset({ directory: resolve(h.temp.root, "datasets"), checkout: REPO, version: 1, key: h.keys.datasetKey, crypto: h.keys.crypto,
        cases: [{ id: randomUUID(), input: h.input, expectation: { requiredDefiningGroups: [["s1"]], allowedUsageNoteRefs: [], allowedOmissionRefs: [], semanticCriteria: ["Controlled coverage."] },
          approval: { reviewer: "local-owner", approvedAt: new Date().toISOString(), reference: "Controlled expectation.", answersInspected: false } }] });
      const loaded = await loadPlannerDataset(frozen.directory, h.keys.crypto);
      const evaluator = createPlannerEvaluator({ store: h.store, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ ...loaded, configuration: PLANNER_CONFIGURATION, capNanoUsd: 2e9 });
      const first = await evaluator.run(id), attemptId = first.outcomes[0].attempt!.id;
      expect(first).toMatchObject({ summary: { validTrials: 2, requiredTrials: 3, verificationUnresolvedTrials: 1, unstartedTrials: 0 }, spend: { physicalRequests: 3, knownNanoUsd: 1260000, outstandingNanoUsd: 0 } });
      expect(first.outcomes[0].attempt?.status).toBe("verification_unresolved");
      h.model.send = async () => { throw new Error("replacement_generation_forbidden"); };
      const restarted = createPlannerEvaluator({ store: h.store, ledger: h.ledger, model: h.model, beforeDispatch: async () => { throw new Error("dispatch_forbidden"); } });
      const recovered = await restarted.recover(id);
      expect(recovered.summary).toMatchObject({ validTrials: 2, expectationPasses: 2, requiredTrials: 3 });
      expect(recovered.outcomes[0].attempt?.id).toBe(attemptId);
      expect(recovered.outcomes.map(o => o.attempt?.id)).toEqual(first.outcomes.map(o => o.attempt?.id));
      expect((await restarted.recover(id)).summary.validTrials).toBe(2);
      expect((await restarted.run(id)).summary.validTrials).toBe(2);
      await expect(recordPlannerDecision(h.store, restarted, { experimentId: id, decision: "promote", reference: "Synthetic check." })).rejects.toThrow("planner_evaluation_not_passing");
      expect(h.remote.sent).toHaveLength(3);
      expect((await evaluator.inspect(id)).outcomes[0].attempt?.id).toBe(attemptId);
    } finally { await h.close(); }
  }, 30000);
  it("waits for durable accounting and retains the completed answer when terminalization writes fail", async () => {
    let accountingBlocked = true, terminalizationBlocked = true;
    const h = await harness([reply()], { append: async type => { if (accountingBlocked && type === "request_outcome") throw new Error("controlled-ledger-failure"); },
      write: async operation => { if (terminalizationBlocked && operation === "finish_attempt") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create();
      expect(await h.coordinator.run(id)).toMatchObject({ status: "paused", outcomeCode: "accounting_unavailable", spend: { knownNanoUsd: 420000, outstandingNanoUsd: 0 } });
      expect((await h.coordinator.recover(id)).outcomeCode).toBe("accounting_unavailable");
      accountingBlocked = false;
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable" });
      const pending = await h.coordinator.inspect(id);
      const response = pending.trials[0].attempt?.requests[0].response;
      expect(response?.kind === "response" && JSON.parse(response.body).completion).toBe(reply().body);
      terminalizationBlocked = false;
      expect((await h.coordinator.recover(id)).trials[0].attempt?.status).toBe("valid");
      expect(h.remote.sent).toHaveLength(1);
      expect((await h.ledger.read()).filter(e => e.type === "request_outcome")).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it("can terminalize a saved completion without generation credentials or provider access", async () => {
    let blocked = true;
    const h = await harness([reply()], { write: async operation => { if (blocked && operation === "finish_attempt") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create(), paused = await h.coordinator.run(id);
      expect(paused).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable" });
      const attempt = paused.trials[0].attempt!;
      expect(attempt.nextEligibleAt).toBeNull();
      blocked = false;
      const executor = createStageExecutor({ store: h.store, ledger: h.ledger, model: createLunaAdapter({ fetch: async () => { throw new Error("network_forbidden"); } }),
        settings: lunaExecutionSettings(LUNA_EXECUTION, PLANNER_CONFIGURATION.maxOutputTokens),
        beforeDispatch: async () => { throw new Error("generation_setup_forbidden"); } });
      const claim = await h.store.claimCandidate(paused.candidateId, id, true);
      try {
        expect(await executor.execute({ runId: id, attemptId: attempt.id, stage: createPlannerStage(PLANNER_CONFIGURATION, h.input), input: h.input,
          allowDispatch: false, ownership: claim, assertOwnership: claim.assert })).toMatchObject({ state: "valid" });
      } finally { await claim.release(); }
      const saved = (await h.store.readAttempt(attempt.id))!;
      expect(saved.requests[0].verifications).toHaveLength(0);
      const response = latestResponse(saved.requests[0]);
      expect(response?.kind === "response" && createPlannerStage(PLANNER_CONFIGURATION, h.input).validate(response.body).ok).toBe(true);
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it("releases ownership if gate permission is revoked while storage is blocked", async () => {
    let blocked = true;
    const h = await harness([reply()], { write: async operation => { if (blocked && operation === "finish_attempt") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create();
      expect((await h.coordinator.run(id)).status).toBe("paused");
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable", claimOwnerRunId: id });
      h.setPermission(false);
      blocked = false;
      const failed = await h.coordinator.recover(id);
      expect(failed).toMatchObject({ status: "failed", outcomeCode: "usefulness_not_accepted", claimOwnerRunId: null });
      expect(failed.trials[0].attempt?.status).toBe("valid");
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it("fences terminalization when ownership is lost after saving a completion", async () => {
    let stale = false;
    const h = await harness([reply()], { write: async operation => { if (operation === "record_outcome") stale = true; } });
    const original = h.store.claimCandidate;
    h.store.claimCandidate = async (...args) => {
      const claim = await original(...args);
      return { ...claim, assert: async () => { if (stale) throw new PrivateError("claim_stale"); await claim.assert(); } };
    };
    try {
      const id = await h.create();
      await expect(h.coordinator.run(id)).rejects.toThrow("claim_stale");
      expect((await h.admin.query("SELECT count(*)::int AS count FROM private.request_verifications")).rows[0].count).toBe(0);
      expect((await h.coordinator.inspect(id)).spend).toMatchObject({ knownNanoUsd: 420000, outstandingNanoUsd: 0 });
      stale = false;
      expect((await h.coordinator.recover(id)).trials[0].attempt?.status).toBe("valid");
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it("selects one normal plan, reuses it, preserves fresh failures and isolates changed settings", async () => {
    const h = await harness([reply(), { status: 200, body: plannerReply({ invalid: true }), headers: { "content-type": "application/json" } }, reply()]);
    try {
      const id = await h.create(), first = await h.coordinator.run(id);
      expect(first).toMatchObject({ status: "accepted", material: { mode: "normal" }, spend: { physicalRequests: 1, knownNanoUsd: 420000, outstandingNanoUsd: 0 }, claimOwnerRunId: null });
      expect(first.authorizations).toHaveLength(1);
      expect(first.authorizations[0].usefulness_result_id).not.toBeNull();
      const reused = await h.coordinator.run(await h.create());
      expect(reused).toMatchObject({ status: "accepted", spend: { physicalRequests: 0, knownNanoUsd: 0 } });
      expect(reused.selected).toEqual(first.selected);
      const failed = await h.coordinator.run(await h.create(true));
      expect(failed.status).toBe("failed");
      expect(failed.selected).toEqual(first.selected);
      const config = { ...PLANNER_CONFIGURATION, maxOutputTokens: 8000 };
      const changed = await h.coordinator.run(await h.create(false, config));
      expect(changed.spend.physicalRequests).toBe(1);
      expect(changed.selected!.reuseIdentity).not.toBe(first.selected!.reuseIdentity);
      h.setPermission(false);
      await expect(h.create()).rejects.toThrow("usefulness_not_accepted");
      expect(h.remote.sent).toHaveLength(3);
      for (const table of ["planner_promotions", "planner_trial_reviews"]) await expect(h.learner.query(`SELECT * FROM private.${table}`)).rejects.toMatchObject({ code: "42501" });
      expect(JSON.stringify(await h.ledger.read())).not.toContain("evanescent");
    } finally { await h.close(); }
  }, 30000);
  it("stops an empty plan and uncertain transport without making replacement calls", async () => {
    const empty = { meanings: [], word_family: [], omitted_source_meanings: [{ source_ref: "s1", reason: "Controlled omission." }] };
    const h = await harness([{ status: 200, body: plannerReply(empty), headers: { "content-type": "application/json" } }, { throws: "controlled-network-loss" }]);
    try {
      const first = await h.coordinator.run(await h.create());
      expect(first).toMatchObject({ status: "rejected", outcomeCode: "no_publishable_meanings" });
      const id = await h.create(true), failed = await h.coordinator.run(id);
      expect(failed).toMatchObject({ status: "failed", outcomeCode: "uncertain", spend: { physicalRequests: 1, unresolvedRequests: 1 } });
      const before = h.remote.sent.length;
      expect((await h.coordinator.recover(id)).spend.unresolvedRequests).toBe(1);
      expect(h.remote.sent).toHaveLength(before);
    } finally { await h.close(); }
  }, 30000);
  it("stops before dispatch on storage and accounting failures, then resumes saved work", async () => {
    let block = true, writeBlocked = false;
    const h = await harness([reply(), reply()], { append: async type => { if (block && type === "dispatch_intent") throw new Error("controlled-ledger-failure"); },
      write: async operation => { if (writeBlocked && operation === "create_attempt") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create(), paused = await h.coordinator.run(id);
      expect(paused).toMatchObject({ status: "paused", outcomeCode: "accounting_unavailable", spend: { physicalRequests: 0 } });
      expect(h.remote.sent).toHaveLength(0);
      block = false;
      expect((await h.coordinator.run(id)).status).toBe("accepted");
      expect(h.remote.sent).toHaveLength(1);
      writeBlocked = true;
      const fresh = await h.create(true);
      expect(await h.coordinator.run(fresh)).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable", spend: { physicalRequests: 0 } });
      expect(h.remote.sent).toHaveLength(1);
      writeBlocked = false;
      expect((await h.coordinator.run(fresh)).status).toBe("accepted");
      expect(h.remote.sent).toHaveLength(2);
    } finally { await h.close(); }
  }, 30000);
  it("freezes encrypted criteria, runs three shared trials and requires exact manual reviews for promotion", async () => {
    const h = await harness(Array.from({ length: 3 }, () => ({ status: 200, body: plannerReply(), headers: { "content-type": "application/json" } })));
    try {
      const frozen = await freezePlannerDataset({ directory: resolve(h.temp.root, "datasets"), checkout: REPO, version: 1, key: h.keys.datasetKey, crypto: h.keys.crypto,
        cases: [{ id: randomUUID(), input: plannerFixture, expectation: { requiredDefiningGroups: [["s1"]], allowedUsageNoteRefs: ["s2"], allowedOmissionRefs: [], semanticCriteria: ["Controlled comparison criteria."] },
          approval: { reviewer: "local-owner", approvedAt: new Date().toISOString(), reference: "Controlled owner stand-in, not a production expectation.", answersInspected: false } }] });
      const loaded = await loadPlannerDataset(frozen.directory, h.keys.crypto);
      const evaluator = createPlannerEvaluator({ store: h.store, ledger: h.ledger, model: h.model, sleep: async () => {} });
      const id = await evaluator.create({ ...loaded, configuration: PLANNER_CONFIGURATION, capNanoUsd: 2e9 });
      const report = await evaluator.run(id);
      expect(report.summary).toMatchObject({ requiredTrials: 3, validTrials: 3, expectationPasses: 3, humanReviewRequired: true });
      expect(h.remote.sent).toHaveLength(3);
      expect(h.remote.sent.some(r => r.body.includes("Controlled comparison criteria"))).toBe(false);
      expect((await evaluator.run(id)).summary.validTrials).toBe(3);
      expect(h.remote.sent).toHaveLength(3);
      await expect(recordPlannerDecision(h.store, evaluator, { experimentId: id, decision: "promote", reference: "Controlled decision." })).rejects.toThrow("planner_review_not_passing");
      for (const outcome of report.outcomes) await recordPlannerReview(h.store, evaluator, { schema: "wordwell-planner-trial-review-v1", reviewer: "local-owner", experimentId: id,
        attemptId: outcome.attempt!.id, resultFingerprint: fingerprint(outcome.attempt!.result), factualityPassed: true, groundingPassed: true, coveragePassed: true, quality: 1,
        findings: ["Controlled poor-style score is comparative, not a numeric veto."], reference: "Controlled review." });
      expect(await recordPlannerDecision(h.store, evaluator, { experimentId: id, decision: "promote", reference: "Controlled decision." })).toMatchObject({ decision: "promote" });
      expect(await requirePlannerPromotion(h.store, createPlannerStage(PLANNER_CONFIGURATION, plannerFixture).fingerprint)).toMatchObject({ decision: "promote" });
      const readExperiment = h.store.readExperiment;
      h.store.readExperiment = async experimentId => {
        const experiment = await readExperiment(experimentId);
        return experiment ? { ...experiment, material: { ...z.record(z.string(), z.unknown()).parse(experiment.material), testedRuleIdentity: "0".repeat(64) } } : null;
      };
      await expect(recordPlannerDecision(h.store, evaluator, { experimentId: id, decision: "promote", reference: "Controlled stale-artifact decision." })).rejects.toThrow("planner_tested_interpretation_changed");
      h.store.readExperiment = readExperiment;
      await recordPlannerDecision(h.store, evaluator, { experimentId: id, decision: "do_not_promote", reference: "Controlled later decision." });
      await expect(requirePlannerPromotion(h.store, report.configurationFingerprint)).rejects.toThrow("planner_configuration_not_promoted");
      expect((await h.admin.query("SELECT count(*)::int AS count FROM private.production_results WHERE stage='planner'")).rows[0].count).toBe(0);
      await expect(h.learner.query("SELECT * FROM private.planner_trial_reviews")).rejects.toMatchObject({ code: "42501" });
    } finally { await h.close(); }
  }, 30000);
  it("retains invalid evaluation outcomes on resume instead of replacing them", async () => {
    const h = await harness([{ status: 200, body: plannerReply({ invalid: true }), headers: { "content-type": "application/json" } }, reply(), reply()]);
    try {
      const cases = [{ id: randomUUID(), input: h.input, expectation: { requiredDefiningGroups: [["s1"]], allowedUsageNoteRefs: [], allowedOmissionRefs: [], semanticCriteria: ["Controlled criteria."] },
        approval: { reviewer: "local-owner" as const, approvedAt: new Date().toISOString(), reference: "Controlled expectation.", answersInspected: false as const } }];
      const frozen = await freezePlannerDataset({ directory: resolve(h.temp.root, "datasets"), checkout: REPO, version: 1, key: h.keys.datasetKey, crypto: h.keys.crypto, cases });
      const loaded = await loadPlannerDataset(frozen.directory, h.keys.crypto), evaluator = createPlannerEvaluator({ store: h.store, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ ...loaded, configuration: PLANNER_CONFIGURATION, capNanoUsd: 2e9 });
      expect((await evaluator.run(id)).spend.physicalRequests).toBe(1);
      const resumed = await evaluator.run(id);
      expect(resumed.summary).toMatchObject({ requiredTrials: 3, validTrials: 2 });
      expect(resumed.outcomes[0].attempt?.status).toBe("invalid");
      expect(h.remote.sent).toHaveLength(3);
      await expect(recordPlannerDecision(h.store, evaluator, { experimentId: id, decision: "promote", reference: "Controlled decision." })).rejects.toThrow("planner_evaluation_not_passing");
    } finally { await h.close(); }
  }, 30000);
  it("fences dispatch after asynchronous setup loses ownership", async () => {
    let stale = false;
    const h = await harness([reply()], { beforeDispatch: async () => { stale = true; } });
    const original = h.store.claimCandidate;
    h.store.claimCandidate = async (...args) => {
      const claim = await original(...args);
      return { ...claim, assert: async () => { if (stale) throw new PrivateError("claim_stale"); await claim.assert(); } };
    };
    try {
      const id = await h.create();
      await expect(h.coordinator.run(id)).rejects.toThrow("claim_stale");
      expect(h.remote.sent).toHaveLength(0);
      expect((await h.coordinator.inspect(id)).spend.physicalRequests).toBe(0);
      stale = false;
      expect((await h.coordinator.recover(id)).status).toBe("paused");
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  }, 30000);
  it("releases a stopped operation when permission disappears during its claim", async () => {
    let h: Awaited<ReturnType<typeof harness>>;
    h = await harness([reply()], { beforeDispatch: async () => { h.setPermission(false); throw new PrivateError("usefulness_not_accepted"); } });
    try {
      const id = await h.create();
      await expect(h.coordinator.run(id)).rejects.toThrow("usefulness_not_accepted");
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "failed", claimOwnerRunId: null, spend: { physicalRequests: 0 } });
      expect((await h.coordinator.inspect(id)).trials[0].attempt?.status).toBe("failed");
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  }, 30000);
  it("restores a ledger-only charge before permission-loss cleanup without dispatch", async () => {
    let blockOutcome = true;
    const h = await harness([reply()], { write: async operation => { if (blockOutcome && operation === "record_outcome") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create();
      expect(await h.coordinator.run(id)).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable", spend: { unresolvedRequests: 1 } });
      expect(h.remote.sent).toHaveLength(1);
      h.setPermission(false);
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable", claimOwnerRunId: id, spend: { unresolvedRequests: 1 } });
      expect(h.remote.sent).toHaveLength(1);
      blockOutcome = false;
      const recovered = await h.coordinator.recover(id);
      expect(recovered).toMatchObject({ status: "failed", outcomeCode: "response_lost", claimOwnerRunId: null,
        spend: { knownNanoUsd: 420000, outstandingNanoUsd: 0, unresolvedRequests: 0, physicalRequests: 1 } });
      expect(recovered.trials[0].attempt?.status).toBe("response_lost");
      expect((await h.coordinator.recover(id)).spend.knownNanoUsd).toBe(420000);
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it("keeps adapter exceptions with reserved requests recoverable and uncertain", async () => {
    const h = await harness([]);
    h.model.send = async () => { throw new PrivateError("luna_sdk_incompatible"); };
    try {
      const id = await h.create();
      await expect(h.coordinator.run(id)).rejects.toThrow("luna_sdk_incompatible");
      expect(await h.coordinator.inspect(id)).toMatchObject({ status: "paused", claimOwnerRunId: id, spend: { unresolvedRequests: 1 } });
      const recovered = await h.coordinator.recover(id);
      expect(recovered).toMatchObject({ status: "failed", outcomeCode: "uncertain", claimOwnerRunId: null, spend: { unresolvedRequests: 1 } });
      expect(recovered.trials[0].attempt?.status).toBe("uncertain");
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  }, 30000);
});
