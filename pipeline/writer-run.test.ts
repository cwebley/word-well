// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fixturePool, harmlessKeys, privateTempDir, REPO, scriptedFetch, testDatabase, type ScriptedReply } from "./testing/private-fixtures.js";
import { createWriterStore } from "./storage/writer.js";
import { createSourceStore } from "./storage/sources.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { createLunaAdapter } from "./execution/openrouter.js";
import { createWriterCoordinator } from "./writer-run.js";
import { WRITER_CONFIGURATION, writerConfigurationSchema, createWriterStage } from "./stages/writer.js";
import { plannerEvidence } from "./sources/planner.js";
import { writerEvidence } from "./sources/writer.js";
import { fingerprint, loadPipelineConfig } from "./config.js";
import { plannerReply, plannerExchangeBody } from "./testing/planner-fixtures.js";
import { bundleSchema } from "./sources/bundle.js";
import { PrivateError } from "./storage/crypto.js";
import { createWriterEvaluator } from "../evals/writer.js";
import { freezeWriterDataset, loadWriterDataset } from "../evals/datasets/writer.js";
import { recordWriterDecision, recordWriterReview, requireWriterPromotion } from "./writer-promotion.js";

describe.skipIf(!process.env.DATABASE_URL)("durable writer paths in restricted disposable databases", () => {
  async function harness(script: ScriptedReply[], faults: { write?: (operation: string) => Promise<void>; append?: (type: string) => Promise<void>; beforeDispatch?: () => Promise<void> } = {}) {
    const database = await testDatabase(), keys = await harmlessKeys(), temp = await privateTempDir();
    const store = await createWriterStore({ connectionString: database.pipelineUrl, storageKey: keys.storageKey, datasetKey: keys.datasetKey, crypto: keys.crypto, beforeWrite: faults.write });
    const sources = await createSourceStore({ connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto });
    const learner = fixturePool(database.learnerUrl);
    const evidence = bundleSchema.parse({ scope: { controlled: true }, artifacts: [], entries: [
      { source: "oewn", id: "entry-fixture", headword: "evanescent", pos: "a", order: 1, role: "candidate", raw: "harmless-source", rawSha256: "a".repeat(64), locator: {}, data: { forms: [] } }
    ], meanings: [{ source: "oewn", entryId: "entry-fixture", id: "meaning-fixture", order: 1, conceptId: "concept-fixture", relations: [], data: { definition: "A harmless adjective fixture.", examples: ["An evanescent fixture."] } }], concepts: [], relations: [],
      frequency: { order: 1, form: "evanescent", tokens: ["evanescent"], storedFrequency: 1e-7, directZipf: 2 }, supplemental: { page_id: "1", revision_id: "1", text_sha256: "a".repeat(64), raw_wikitext: "harmless-source", authenticatesKaikki: false, meanings: [] },
      diagnostics: [], coverage: { candidates: ["evanescent"], fullCorpus: false, oewnMeanings: 1, kaikkiMeanings: 6 }, modelCalls: 0 });
    const bundleId = fingerprint(evidence);
    await sources.importBundle({ id: bundleId, intention: { controlled: true }, load: async () => evidence });
    const assessed = await sources.assess({ bundleId, headword: "evanescent", configFingerprint: "a".repeat(64), resolution: { controlled: true }, assessment: { disposition: "pass" } });
    const gateRun = randomUUID(), approprId = randomUUID(), usefulId = randomUUID(), planId = randomUUID();
    await store.createProductionRun({ id: gateRun, candidateId: assessed.candidateId, capNanoUsd: 1, material: { controlledPrerequisites: true } });
    for (const [stage, id] of [["appropriateness", approprId], ["usefulness", usefulId], ["planner", planId]]) {
      const claim = await store.claimCandidate(assessed.candidateId, gateRun, true);
      try { await store.completeProduction(claim, { stage, status: "accepted", result: { id, reuseIdentity: "a".repeat(64), material: { controlledPrerequisite: true } }, continuing: stage !== "planner" }); }
      finally { await claim.release(); }
    }
    const plan = { meanings: [{ definition: "A harmless planned adjective.", part_of_speech: "adjective" as const, sense_ids: ["s1"], usage_note_sense_ids: [], synonyms: [] }], word_family: [], omitted_source_meanings: [] };
    const plannerInput = plannerEvidence(bundleId, evidence), remote = scriptedFetch(script);
    const model = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch });
    const ledger = await createReceiptLedger({ directory: resolve(temp.root, "ledger"), checkout: REPO, beforeAppend: faults.append });
    const config = await loadPipelineConfig("config/pipeline.yaml");
    let permission = true;
    let currentPlanId: string = planId;
    const authorization = async (selected: string) => {
      if (!permission || selected !== bundleId) throw new PrivateError("planner_not_current");
      return { candidateId: assessed.candidateId, headword: "evanescent", bundleId, assessmentId: assessed.assessmentId, appropriatenessResultId: approprId, usefulnessResultId: usefulId, plannerResultId: currentPlanId, input: plannerInput, plan };
    };
    const coordinator = createWriterCoordinator({ store, sources, ledger, model, executionKind: "controlled", currentIntake: async () => config,
      authorizePlan: authorization, sleep: async () => {}, beforeDispatch: faults.beforeDispatch });
    const create = (fresh = false, configuration = WRITER_CONFIGURATION, stageOnly = false) => coordinator.create({ bundleId, candidate: "evanescent", configuration, capNanoUsd: 2e9, fresh, stageOnly });
    return { store, sources, keys, temp, learner, remote, model, ledger, coordinator, create, bundleId, evidence, plan, plannerInput, connectionString: database.pipelineUrl,
      authorization, config, candidateId: assessed.candidateId, input: writerEvidence(bundleId, evidence, plannerInput, plan),
      setPermission: (value: boolean) => { permission = value; }, setPlanId: (id: string) => { currentPlanId = id; },
      replacePlan: async () => {
        const id = randomUUID(), resultId = randomUUID();
        await store.createProductionRun({ id, candidateId: assessed.candidateId, capNanoUsd: 1, material: { controlledReplacement: true } });
        const claim = await store.claimCandidate(assessed.candidateId, id);
        try { await store.completeProduction(claim, { stage: "planner", status: "accepted", result: { id: resultId, reuseIdentity: "a".repeat(64), material: { controlledReplacement: true } } }); }
        finally { await claim.release(); }
        currentPlanId = resultId;
        return resultId;
      },
      close: async () => { await Promise.all([store.close(), sources.close(), learner.end()]); await database.drop(); await temp.cleanup(); } };
  }
  const written = { meanings: [{ meaning_id: "m1", examples: ["An evanescent fixture!", "The evanescent fixture faded.", "An evanescent fixture briefly appeared."],
    situation: "Describing a harmless fixture", not_for: "Describing a lasting fixture", common_patterns: ["an evanescent fixture"], synonyms: [], usage_notes: [], origin_note: null }] };
  const reply = (value: unknown = written) => ({ status: 200, body: plannerReply(value), headers: { "content-type": "application/json" } });

  it("rechecks permission after asynchronous setup before sending a writer request", async () => {
    let h: Awaited<ReturnType<typeof harness>>;
    h = await harness([reply()], { beforeDispatch: async () => { h.setPermission(false); } });
    try {
      const id = await h.create();
      await expect(h.coordinator.run(id)).rejects.toThrow("planner_not_current");
      expect(h.remote.sent).toHaveLength(0);
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "failed", claimOwnerRunId: null, spend: { physicalRequests: 0 } });
    } finally { await h.close(); }
  }, 30000);
  it("selects one writer result, reuses content with new authorization, and preserves earlier stages and failed fresh selections", async () => {
    const h = await harness([reply(), reply({ invalid: true }), reply()]);
    try {
      const earlier = await Promise.all(["appropriateness", "usefulness", "planner"].map(stage => h.store.selectedProductionResult(h.candidateId, stage)));
      const first = await h.coordinator.run(await h.create());
      expect(first).toMatchObject({ status: "accepted", material: { mode: "normal" }, spend: { physicalRequests: 1, knownNanoUsd: 420000 }, claimOwnerRunId: null });
      expect(first.authorizations).toHaveLength(1);
      const reused = await h.coordinator.run(await h.create());
      expect(reused.spend.physicalRequests).toBe(0);
      expect(reused.selected).toEqual(first.selected);
      const failed = await h.coordinator.run(await h.create(true));
      expect(failed.status).toBe("failed");
      expect(failed.selected).toEqual(first.selected);
      const changed = await h.coordinator.run(await h.create(false, { ...WRITER_CONFIGURATION, maxOutputTokens: 8000 }, true));
      expect(changed).toMatchObject({ status: "accepted", material: { mode: "stage-only" }, spend: { physicalRequests: 1 } });
      expect(changed.selected!.reuseIdentity).not.toBe(first.selected!.reuseIdentity);
      expect(await Promise.all(["appropriateness", "usefulness", "planner"].map(stage => h.store.selectedProductionResult(h.candidateId, stage)))).toEqual(earlier);
      const newPlanId = await h.replacePlan();
      const renewed = await h.coordinator.run(await h.create(false, { ...WRITER_CONFIGURATION, maxOutputTokens: 8000 }));
      expect(renewed.spend.physicalRequests).toBe(0);
      expect(renewed.selected).toEqual(changed.selected);
      expect(renewed.authorizations[0].planner_result_id).toBe(newPlanId);
      expect(h.remote.sent).toHaveLength(3);
      expect(JSON.stringify(await h.ledger.read())).not.toContain("evanescent");
      for (const table of ["writer_authorizations", "writer_trial_reviews", "writer_promotions"]) await expect(h.learner.query(`SELECT * FROM private.${table}`)).rejects.toMatchObject({ code: "42501" });
    } finally { await h.close(); }
  }, 30000);
  it("refuses live execution before run creation when writer promotion is missing", async () => {
    const h = await harness([]);
    try {
      const live = createWriterCoordinator({ store: h.store, sources: h.sources, ledger: h.ledger, model: h.model, executionKind: "live", currentIntake: async () => h.config, authorizePlan: h.authorization });
      await expect(live.create({ bundleId: h.bundleId, candidate: "evanescent", configuration: WRITER_CONFIGURATION, capNanoUsd: 2e9 })).rejects.toThrow("writer_configuration_not_promoted");
      expect(h.remote.sent).toHaveLength(0);
      expect(await h.store.selectedProductionResult(h.candidateId, "writer")).toBeNull();
    } finally { await h.close(); }
  }, 30000);
  it("terminalizes missing inline proof and retains the same charged answer on repeated production commands", async () => {
    const h = await harness([{ ...reply(), body: plannerReply(written, { openrouter_metadata: undefined }) }]);
    try {
      const id = await h.create(), unresolved = await h.coordinator.run(id);
      expect(unresolved).toMatchObject({ status: "failed", outcomeCode: "luna_verification_unresolved", selected: null, spend: { physicalRequests: 1, knownNanoUsd: 420000, outstandingNanoUsd: 0 } });
      expect(unresolved.trials[0].attempt?.status).toBe("verification_unresolved");
      h.model.send = async () => { throw new Error("replacement_generation_forbidden"); };
      expect((await h.coordinator.recover(id)).status).toBe("failed");
      expect(await h.coordinator.run(id)).toMatchObject({ status: "failed", spend: { physicalRequests: 1 } });
      expect(h.remote.sent).toHaveLength(1);
      expect((await h.store.readAttempt(unresolved.trials[0].attemptId))?.requests[0].response).toEqual(unresolved.trials[0].attempt?.requests[0].response);
    } finally { await h.close(); }
  }, 30000);
  it("restores ledger-only charges before cleaning up revoked permission", async () => {
    let block = true;
    const h = await harness([reply()], { write: async operation => { if (block && operation === "record_outcome") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create();
      expect(await h.coordinator.run(id)).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable", spend: { unresolvedRequests: 1 } });
      h.setPermission(false);
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "paused", outcomeCode: "storage_unavailable", claimOwnerRunId: id });
      block = false;
      expect(await h.coordinator.recover(id)).toMatchObject({ status: "failed", outcomeCode: "response_lost", claimOwnerRunId: null, spend: { physicalRequests: 1, knownNanoUsd: 420000, outstandingNanoUsd: 0, unresolvedRequests: 0 } });
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  it("resumes a completed answer after an atomic selection write fails without dispatching again", async () => {
    let block = true;
    const h = await harness([reply()], { write: async operation => { if (block && operation === "complete_writer") throw new PrivateError("storage_unavailable"); } });
    try {
      const id = await h.create();
      await expect(h.coordinator.run(id)).rejects.toThrow("storage_unavailable");
      expect(await h.coordinator.inspect(id)).toMatchObject({ status: "paused", selected: null, authorizations: [], spend: { physicalRequests: 1 } });
      block = false;
      expect((await h.coordinator.run(id)).status).toBe("accepted");
      expect(h.remote.sent).toHaveLength(1);
    } finally { await h.close(); }
  }, 30000);
  async function frozen(h: Awaited<ReturnType<typeof harness>>) {
    const saved = await freezeWriterDataset({ directory: resolve(h.temp.root, "datasets"), checkout: REPO, version: 1, key: h.keys.datasetKey, crypto: h.keys.crypto,
      cases: [{ id: randomUUID(), input: h.input, expectation: { semanticCriteria: ["Private owner criteria marker, never a writer input."] }, split: "development",
        approval: { reviewer: "local-owner", approvedAt: new Date().toISOString(), reference: "Controlled expectation and fixed-plan approval.", fixedPlanApproved: true, answersInspected: false } }] });
    return loadWriterDataset(saved.directory, h.keys.crypto);
  }
  it("freezes a fixed plan, runs three shared writer trials, and binds promotion to exact owner reviews", async () => {
    const h = await harness([reply(), reply(), reply()]);
    try {
      const evaluator = createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model, sleep: async () => {} });
      const id = await evaluator.create({ ...await frozen(h), configuration: WRITER_CONFIGURATION, capNanoUsd: 2e9 });
      const report = await evaluator.run(id);
      expect(report.summary).toMatchObject({ requiredTrials: 3, validTrials: 3, humanReviewRequired: true, splits: { development: 1, heldOut: 0 } });
      expect(h.remote.sent).toHaveLength(3);
      expect(h.remote.sent.some(r => r.body.includes("Private owner criteria marker"))).toBe(false);
      expect(await h.store.selectedProductionResult(h.candidateId, "writer")).toBeNull();
      await expect(recordWriterDecision(h.store, evaluator, { experimentId: id, decision: "promote", reference: "Controlled decision." })).rejects.toThrow("writer_review_not_passing");
      for (const outcome of report.outcomes) await recordWriterReview(h.store, evaluator, { schema: "wordwell-writer-trial-review-v1", reviewer: "local-owner", experimentId: id,
        attemptId: outcome.attempt!.id, resultFingerprint: fingerprint(outcome.attempt!.result), factualityPassed: true, groundingPassed: true, coveragePassed: true,
        examplesAndCoachingReviewed: true, contrastsReviewed: true, notesReviewed: true, patternsReviewed: true, quality: 1, findings: ["Controlled style score has no numeric threshold."], reference: "Controlled review." });
      expect(await recordWriterDecision(h.store, evaluator, { experimentId: id, decision: "promote", reference: "Controlled decision." })).toMatchObject({ decision: "promote", modelCalls: 0 });
      expect((await requireWriterPromotion(h.store, report.configurationFingerprint)).decision).toBe("promote");
      await recordWriterDecision(h.store, evaluator, { experimentId: id, decision: "do_not_promote", reference: "Controlled later decision." });
      await expect(requireWriterPromotion(h.store, report.configurationFingerprint)).rejects.toThrow("writer_configuration_not_promoted");
      expect((await evaluator.run(id)).summary.validTrials).toBe(3);
      expect(h.remote.sent).toHaveLength(3);
    } finally { await h.close(); }
  }, 30000);
  it("keeps failed trial identities and denominators when continuing an evaluation", async () => {
    const h = await harness([reply({ invalid: true }), reply(), reply()]);
    try {
      const evaluator = createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ ...await frozen(h), configuration: WRITER_CONFIGURATION, capNanoUsd: 2e9 });
      const first = await evaluator.run(id);
      expect(first.summary).toMatchObject({ requiredTrials: 3, validTrials: 0 });
      expect(h.remote.sent).toHaveLength(1);
      const resumed = await evaluator.run(id);
      expect(resumed.summary).toMatchObject({ requiredTrials: 3, validTrials: 2 });
      expect(resumed.outcomes[0].attempt?.id).toBe(first.outcomes[0].attempt?.id);
      expect(resumed.outcomes[0].attempt?.status).toBe("invalid");
      expect(h.remote.sent).toHaveLength(3);
      await expect(recordWriterDecision(h.store, evaluator, { experimentId: id, decision: "promote", reference: "Controlled decision." })).rejects.toThrow("writer_evaluation_not_passing");
    } finally { await h.close(); }
  }, 30000);
  it("continues serial evaluation after unresolved proof and preserves the denominator and original identities on restart", async () => {
    const h = await harness([{ ...reply(), body: plannerReply(written, { openrouter_metadata: undefined }) }, reply(), reply()]);
    try {
      const evaluator = createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ ...await frozen(h), configuration: WRITER_CONFIGURATION, capNanoUsd: 2e9 });
      const first = await evaluator.run(id);
      expect(first.summary).toMatchObject({ requiredTrials: 3, validTrials: 2, verificationUnresolvedTrials: 1, unstartedTrials: 0 });
      expect(first.outcomes[0].attempt?.status).toBe("verification_unresolved");
      expect(first.spend).toMatchObject({ physicalRequests: 3, knownNanoUsd: 1260000, outstandingNanoUsd: 0 });
      h.model.send = async () => { throw new Error("redispatch_forbidden"); };
      const reopened = await createWriterStore({ connectionString: h.connectionString, storageKey: h.keys.storageKey, datasetKey: h.keys.datasetKey, crypto: h.keys.crypto });
      try {
        const freshLedger = await createReceiptLedger({ directory: resolve(h.temp.root, "ledger"), checkout: REPO });
        const restarted = createWriterEvaluator({ store: reopened, ledger: freshLedger,
          model: createLunaAdapter({ fetch: async () => { throw new Error("network_forbidden_on_restart"); } }) });
        const recovered = await restarted.recover(id);
        expect(recovered.outcomes[0].attempt?.id).toBe(first.outcomes[0].attempt?.id);
        expect(recovered.outcomes.map(o => o.attempt?.id)).toEqual(first.outcomes.map(o => o.attempt?.id));
        expect((await restarted.run(id)).summary.validTrials).toBe(2);
        await expect(recordWriterDecision(reopened, restarted, { experimentId: id, decision: "promote", reference: "Synthetic check." })).rejects.toThrow("writer_evaluation_not_passing");
      } finally { await reopened.close(); }
      expect(h.remote.sent).toHaveLength(3);
    } finally { await h.close(); }
  }, 30000);
  it("inspects original historical evidence without restamping it and refuses recovery through the changed implementation", async () => {
    const h = await harness([]);
    try {
      const config = writerConfigurationSchema.parse({ schema: "wordwell-writer-configuration-v1", stage: "writer", route: WRITER_CONFIGURATION.route,
        requestedModel: WRITER_CONFIGURATION.requestedModel, pinnedModel: WRITER_CONFIGURATION.pinnedModel, provider: WRITER_CONFIGURATION.provider,
        maxOutputTokens: WRITER_CONFIGURATION.maxOutputTokens, prompt: WRITER_CONFIGURATION.prompt, contrastEvidence: WRITER_CONFIGURATION.contrastEvidence,
        routingVerification: "authenticated-generation-resumable-v1", metadataRecovery: "saved-completion-append-only-rounds-v1",
        routingLookup: { maxAttempts: 6, maxWaitMs: 30000, delaysMs: [1000, 2000, 4000, 8000, 8000] } });
      const evaluator = createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model });
      const dataset = await frozen(h);
      await expect(evaluator.create({ ...dataset, configuration: config, capNanoUsd: 2e9 })).rejects.toThrow("writer_configuration_historical_only");
      const id = randomUUID(), caseId = dataset.dataset.cases[0].id, attemptId = randomUUID(), requestId = randomUUID();
      const stage = createWriterStage(config, h.input);
      const implementation = "8c2dc422adb33346554f5fe22afb5a870128e1590ddb70d3a24e228ed21f6fc9";
      await h.store.createExperiment({ id, stage: "writer", dataset: { id: dataset.dataset.id, version: 1, ciphertextSha256: dataset.manifest.ciphertextSha256 },
        configurationFingerprint: stage.fingerprint, implementationFingerprint: implementation, capNanoUsd: 2e9,
        material: { schema: "wordwell-writer-evaluation-v1", configuration: config, execution: (await import("./planner-config.js")).LUNA_EXECUTION,
          implementation, testedRuleIdentity: "58cf011a6656c0368feb2e28f0509dfaf62c72f6ba1f40868448531a4b8ee11f", datasetContentIdentity: dataset.dataset.contentIdentity },
        stageCases: [{ caseId, position: 0, input: h.input, expectation: { expectation: dataset.dataset.cases[0].expectation, split: "development", approval: {} } }] });
      await h.store.trialAttempt(id, caseId, 1, attemptId);
      await h.store.createAttempt({ id: attemptId, experimentId: id, stage: "writer", input: { input: h.input, request: stage.render(h.input) } });
      await h.store.reserveRequest({ requestId, attemptId, experimentId: id, sequence: 1, reservedNanoUsd: 397600000, at: new Date() });
      await h.store.recordOutcome(requestId, { status: "responded", httpStatus: 200, retryable: false, retryAfterMs: null, generationId: "gen-harmless-planner",
        inputTokens: 900, outputTokens: 200, chargeNanoUsd: 420000, completedAt: new Date(),
        response: { kind: "response", status: 200, body: plannerExchangeBody(written), contentType: "application/json", retryAfter: null } });
      await h.store.finishAttempt(attemptId, { status: "valid", outcomeCode: null, result: written });
      const before = await h.store.readExperiment(id);
      expect((await evaluator.inspect(id)).summary.validTrials).toBe(1);
      await expect(evaluator.recover(id)).rejects.toThrow("implementation_changed");
      await expect(evaluator.run(id)).rejects.toThrow("implementation_changed");
      expect(await h.store.readExperiment(id)).toEqual(before);
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  }, 30000);
  it.each(["accounting", "storage", "unknown_charge", "budget"])("stops independent evaluation progress on %s blockage", async kind => {
    let blocked = true;
    const missing = plannerReply(written, { openrouter_metadata: undefined,
      ...(kind === "unknown_charge" ? { usage: { prompt_tokens: 900, completion_tokens: 200 } } : {}) });
    const h = await harness([{ ...reply(), body: missing }, reply(), reply()], {
      append: async type => { if (blocked && kind === "accounting" && type === "request_outcome") throw new Error("controlled-accounting-failure"); },
      write: async operation => { if (blocked && kind === "storage" && operation === "finish_attempt") throw new PrivateError("storage_unavailable"); }
    });
    try {
      const evaluator = createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model, sleep: async () => {} });
      const id = await evaluator.create({ ...await frozen(h), configuration: WRITER_CONFIGURATION, capNanoUsd: kind === "budget" ? 397600000 : 2e9 });
      const first = await evaluator.run(id);
      expect(first.summary).toMatchObject({ requiredTrials: 3, validTrials: 0 });
      expect(h.remote.sent).toHaveLength(1);
      expect(first.outcomes[0].attempt?.status).toBe(kind === "accounting" || kind === "storage" ? "pending" : "verification_unresolved");
      expect(first.outcomes[1].attempt?.requests ?? []).toHaveLength(0);
      if (kind === "unknown_charge") {
        expect(first.spend).toMatchObject({ unresolvedRequests: 1, outstandingNanoUsd: 397600000 });
        expect((await evaluator.run(id)).summary.unstartedTrials).toBe(2);
      } else if (kind === "budget") {
        expect((await evaluator.run(id)).spend.physicalRequests).toBe(1);
      } else {
        expect((await evaluator.run(id)).summary.validTrials).toBe(0);
        blocked = false;
        expect((await evaluator.run(id)).summary).toMatchObject({ validTrials: 2, verificationUnresolvedTrials: 1 });
        expect(h.remote.sent).toHaveLength(3);
      }
    } finally { await h.close(); }
  }, 30000);

  it.each(["truncated", "malformed_accounting"])("retains the charge and continues after unresolved %s evidence", async kind => {
    const override = kind === "truncated"
      ? { choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", content: "", refusal: null } }] }
      : { id: null, usage: { prompt_tokens: null, completion_tokens: 200, cost: 0.00042 } };
    const h = await harness([{ ...reply(), body: plannerReply(written, { ...override, openrouter_metadata: undefined }) }, reply(), reply()]);
    try {
      const evaluator = createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ ...await frozen(h), configuration: WRITER_CONFIGURATION, capNanoUsd: 2e9 });
      const report = await evaluator.run(id);
      expect(report.summary).toMatchObject({ validTrials: 2, verificationUnresolvedTrials: 1, unstartedTrials: 0 });
      expect(report.spend).toMatchObject({ physicalRequests: 3, knownNanoUsd: 1260000, outstandingNanoUsd: 0, unresolvedRequests: 0 });
      expect(report.outcomes[0].attempt?.requests[0]).toMatchObject({ chargeStatus: "known", chargeNanoUsd: 420000 });
    } finally { await h.close(); }
  }, 30000);

  it("prevents competing evaluators from dispatching while one owns an unresolved trial's completion", async () => {
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(done => { entered = done; }), gate = new Promise<void>(done => { release = done; });
    const h = await harness([{ ...reply(), body: plannerReply(written, { openrouter_metadata: undefined }) }, reply(), reply()], {
      write: async operation => { if (operation === "finish_attempt") { entered(); await gate; } }
    });
    try {
      const evaluator = createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model });
      const id = await evaluator.create({ ...await frozen(h), configuration: WRITER_CONFIGURATION, capNanoUsd: 2e9 });
      const running = evaluator.run(id);
      await reached;
      await expect(createWriterEvaluator({ store: h.store, ledger: h.ledger, model: h.model }).run(id)).rejects.toThrow("experiment_busy");
      expect(h.remote.sent).toHaveLength(1);
      release();
      const finished = await running;
      expect(finished.summary).toMatchObject({ validTrials: 2, verificationUnresolvedTrials: 1 });
      expect(h.remote.sent).toHaveLength(3);
    } finally { release(); await h.close(); }
  }, 30000);
  it("scopes optional origins and keeps external quotations out of writer input", async () => {
    const h = await harness([]);
    try {
      const evidence = structuredClone(h.evidence);
      evidence.entries.push({ source: "kaikki", id: "line:1", headword: "evanescent", pos: "adj", order: 1, role: "candidate", raw: "harmless-entry", rawSha256: "b".repeat(64), locator: {},
        data: { etymology_text: "A controlled origin.", etymology_number: 1, senses: [{ examples: [{ type: "quotation", text: "External quotation marker." }] }] } });
      evidence.meanings.push({ source: "kaikki", entryId: "line:1", id: "line:1:meaning:1", order: 1, conceptId: null, relations: [], data: { examples: [{ type: "quotation", text: "External quotation marker." }] } });
      const input = writerEvidence(h.bundleId, evidence, h.plannerInput, h.plan);
      expect(input.meanings[0].origin).toMatchObject({ source_ref: "line:1", rawSha256: "b".repeat(64), text: "A controlled origin." });
      expect(input.excludedQuotations).toEqual([{ source_ref: "line:1:meaning:1", text: "External quotation marker." }]);
      expect(input.meanings[0].examples).toEqual([{ source_ref: "s1", text: "An evanescent fixture." }]);
      evidence.entries.push({ ...evidence.entries.at(-1)!, id: "line:2", data: { etymology_text: "Another controlled origin.", etymology_number: 2 } });
      const ambiguous = writerEvidence(h.bundleId, evidence, h.plannerInput, h.plan);
      expect(ambiguous.meanings[0]).toMatchObject({ origin: null, originAbsence: "Multiple origins lack an unambiguous planned-meaning mapping." });
      const empty = { ...h.plan, meanings: [], omitted_source_meanings: [{ source_ref: "s1", reason: "Controlled omission." }] };
      expect(() => writerEvidence(h.bundleId, evidence, h.plannerInput, empty)).toThrow("planner_not_publishable");
    } finally { await h.close(); }
  }, 30000);
  it("preserves reference-only quotation metadata without blocking writer input assembly", async () => {
    const h = await harness([]);
    try {
      const evidence = structuredClone(h.evidence);
      // Observed Kaikki shape: quotation type and bibliography, but no text.
      evidence.meanings.push({ source: "kaikki", entryId: "line:1", id: "line:1:meaning:1", order: 1, conceptId: null, relations: [],
        data: { examples: [{ type: "quotation", ref: "A retained bibliographic reference." }] } });
      expect(writerEvidence(h.bundleId, evidence, h.plannerInput, h.plan).excludedQuotations).toEqual([]);
      expect(evidence.meanings.at(-1)?.data).toEqual({ examples: [{ type: "quotation", ref: "A retained bibliographic reference." }] });
    } finally { await h.close(); }
  }, 30000);
  it("maps only selected contrast definitions from their exact pinned linked meanings and stops on missing support", async () => {
    const h = await harness([]);
    try {
      const evidence = structuredClone(h.evidence);
      evidence.entries.push({ source: "oewn", id: "linked-entry", headword: "transient", pos: "a", order: 2, role: "linked", raw: "harmless-linked", rawSha256: "b".repeat(64), locator: {}, data: {} });
      evidence.meanings.push({ source: "oewn", entryId: "linked-entry", id: "linked-meaning", order: 2, conceptId: "linked-concept", relations: [], data: { definition: "Lasting briefly in a controlled fixture.", examples: ["An example that must not enter the writer payload."] } });
      evidence.relations.push({ source: "oewn", from: "meaning-fixture", to: "linked-meaning", word: "transient", type: "similar", purpose: "contrast" });
      // An unselected target is eligible to the planner but never opened by the writer mapper.
      evidence.relations.push({ source: "oewn", from: "meaning-fixture", to: "unselected-meaning", word: "other", type: "similar", purpose: "contrast" });
      const plannerInput = plannerEvidence(h.bundleId, evidence), plan = { ...h.plan, meanings: [{ ...h.plan.meanings[0], synonyms: ["transient"] }] };
      const input = writerEvidence(h.bundleId, evidence, plannerInput, plan);
      expect(input.meanings[0].contrastDefinitions).toEqual([{ synonym: "transient", definitions: [{ sourceId: "linked-meaning", definition: "Lasting briefly in a controlled fixture." }] }]);
      evidence.meanings = evidence.meanings.filter(m => m.id !== "linked-meaning");
      expect(() => writerEvidence(h.bundleId, evidence, plannerInput, plan)).toThrow("writer_contrast_evidence_missing");
      expect(h.remote.sent).toHaveLength(0);
    } finally { await h.close(); }
  }, 30000);
});
