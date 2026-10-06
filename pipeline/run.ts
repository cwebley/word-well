// Production coordination owns current permissions, candidate claims and
// selection. Every intentional trial goes through the existing executor.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type PipelineConfig } from "./config.js";
import { createStageExecutor } from "./execution/executor.js";
import type { ModelAdapter } from "./execution/model.js";
import { APPROPRIATENESS_CONFIGURATION, averageDecision, createAppropriatenessStage, resultSchema, thresholdsFor, TRIALS } from "./stages/appropriateness.js";
import { PrivateError } from "./storage/crypto.js";
import type { PrivateStore } from "./storage/postgres.js";
import type { SourceStore } from "./storage/sources.js";
import type { ReceiptLedger } from "./storage/receipts.js";
import { authorizeScopedCandidate } from "./sources/index.js";
import { appropriatenessReuseIdentity, productionImplementation } from "./reuse.js";
import { executionSettings, runMaterialSchema, type RunMaterial } from "./production-config.js";
import type { LocalConfig } from "../evals/private-appropriateness.js";
import { requirePromotion } from "./promotion.js";

const decisionSchema = z.object({ blockedProbability: z.number().min(0).max(1), slurProbability: z.number().min(0).max(1).nullable(),
  vulgarProbability: z.number().min(0).max(1).nullable(), disposition: z.enum(["accept", "reject"]) }).strict();
export const productionResultSchema = z.object({ schema: z.literal("wordwell-production-appropriateness-v1"), executionKind: z.enum(["live", "controlled"]),
  trialAttemptIds: z.array(z.uuid()).length(3), decision: decisionSchema, input: z.object({ headword: z.string() }).strict(),
  configurationFingerprint: z.string(), originalAssessmentId: z.string().regex(/^[a-f0-9]{64}$/), bundleId: z.string() }).strict();

export function createProductionCoordinator(deps: {
  store: PrivateStore; sources: SourceStore; ledger: ReceiptLedger;
  // Controlled execution is an explicit test dependency, never a CLI live bypass.
  execution: { kind: "controlled" | "live"; model: ModelAdapter };
  currentIntake: () => Promise<PipelineConfig>;
  beforeDispatch?: () => Promise<void>;
  implementation?: string; sleep?: (ms: number) => Promise<void>;
}) {
  const { store } = deps;
  async function load(runId: string) {
    const run = await store.readProductionRun(runId);
    if (!run) throw new PrivateError("run_missing");
    return { run, material: runMaterialSchema.parse(run.material) };
  }
  async function current(material: RunMaterial) {
    const authorization = await authorizeScopedCandidate(deps.sources, material.bundleId, await deps.currentIntake());
    if (authorization.candidateId !== material.candidateId || authorization.headword !== material.input.headword) throw new PrivateError("candidate_input_changed");
    const promotion = material.executionKind === "live" ? await requirePromotion(store, createAppropriatenessStage(material.configuration).fingerprint) : null;
    return { ...authorization, promotionId: promotion?.id };
  }
  async function compatible(material: RunMaterial) {
    if (material.implementation !== (deps.implementation ?? await productionImplementation())) throw new PrivateError("implementation_changed");
    if (material.executionKind !== deps.execution.kind) throw new PrivateError("execution_kind_mismatch");
    if (deps.execution.model.route !== material.configuration.route) throw new PrivateError("model_adapter_unavailable");
    if (await appropriatenessReuseIdentity(material.input, material.configuration) !== material.reuseIdentity) throw new PrivateError("reuse_identity_changed");
  }
  async function inspect(runId: string) {
    const { run, material } = await load(runId);
    const trials = await store.productionTrials(runId);
    return { ...run, material, claimOwnerRunId: await store.candidateClaim(run.candidateId),
      trials: await Promise.all(trials.map(async t => ({ ...t, attempt: await store.readAttempt(t.attemptId) }))),
      selected: await store.selectedProductionResult(run.candidateId), history: await store.productionHistory(run.candidateId),
      spend: await store.productionSpend(runId) };
  }
  async function reconcileTerminalAccounting(runId: string) {
    const receipts = (await deps.ledger.read()).filter(r => r.runId === runId);
    for (const trial of await store.productionTrials(runId)) {
      const attempt = await store.readAttempt(trial.attemptId);
      for (const receipt of receipts) {
        if (receipt.type === "dispatch_cancelled" && receipt.attemptId === trial.attemptId && attempt?.requests.some(r => r.id === receipt.requestId))
          await store.abandonRequest(receipt.requestId, true);
        if (receipt.type === "request_outcome" && receipt.chargeNanoUsd !== null && receipt.attemptId === trial.attemptId &&
            attempt?.requests.some(r => r.id === receipt.requestId && r.chargeStatus === "unknown"))
          await store.reconcileRequestAccounting(receipt.requestId, { ...receipt, chargeNanoUsd: receipt.chargeNanoUsd });
      }
    }
  }
  return {
    inspect,
    async create(options: { bundleId: string; candidate: string; intake: PipelineConfig; config: LocalConfig; capNanoUsd: number; fresh?: boolean; stageOnly?: boolean }) {
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
      const authorization = await authorizeScopedCandidate(deps.sources, options.bundleId, options.intake);
      if (authorization.headword !== options.candidate) throw new PrivateError("candidate_outside_bundle_scope");
      const stage = createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION);
      if (deps.execution.kind === "live") {
        await requirePromotion(store, stage.fingerprint);
        if (options.config.pricing.status !== "verified") throw new PrivateError("pricing_unverified");
      }
      const id = randomUUID();
      const material = runMaterialSchema.parse({ schema: "wordwell-production-run-v1", stage: "appropriateness", mode: options.stageOnly ? "stage-only" : "normal",
        fresh: options.fresh ?? false, executionKind: deps.execution.kind, bundleId: options.bundleId, candidateId: authorization.candidateId,
        lessonId: authorization.lessonId, assessmentId: authorization.assessmentId, input: authorization.appropriatenessInput,
        intake: options.intake, configuration: stage.configuration, execution: options.config,
        implementation: deps.implementation ?? await productionImplementation(), reuseIdentity: await appropriatenessReuseIdentity(authorization.appropriatenessInput, APPROPRIATENESS_CONFIGURATION) });
      await store.createProductionRun({ id, candidateId: authorization.candidateId, capNanoUsd: options.capNanoUsd, material });
      return id;
    },
    async run(runId: string) {
      const { run, material } = await load(runId);
      if (["accepted", "rejected", "failed"].includes(run.status)) return inspect(runId);
      await compatible(material);
      await current(material);
      const claim = await store.claimCandidate(run.candidateId, runId).catch(async error => {
        if (error instanceof PrivateError && error.code === "run_completed") return null;
        throw error;
      });
      if (!claim) return inspect(runId);
      try {
        const authorization = await current(material);
        const selected = !material.fresh ? await store.selectedProductionResult(run.candidateId) : null;
        if (selected?.reuseIdentity === material.reuseIdentity) {
          const saved = productionResultSchema.parse(selected.material);
          if (saved.executionKind === material.executionKind) {
            await store.completeProduction(claim, { status: saved.decision.disposition === "accept" ? "accepted" : "rejected",
              reusedResultId: selected.id, assessmentId: authorization.assessmentId, promotionId: authorization.promotionId });
            return inspect(runId);
          }
        }
        const stage = createAppropriatenessStage(material.configuration);
        const executor = createStageExecutor({ store, ledger: deps.ledger, model: deps.execution.model, settings: executionSettings(material.execution), sleep: deps.sleep });
        const results = [];
        const attemptIds = [];
        for (let trialIndex = 1; trialIndex <= TRIALS; trialIndex++) {
          await claim.assert();
          const attemptId = await store.productionTrial(runId, trialIndex);
          attemptIds.push(attemptId);
          const outcome = await executor.execute({ runId, attemptId, stage, input: material.input, assertOwnership: claim.assert, ownership: claim, beforeDispatch: async () => {
            await current(material); await deps.beforeDispatch?.(); await claim.assert();
          } });
          if (outcome.state !== "valid") {
            await store.completeProduction(claim, { status: outcome.state === "paused" ? "paused" : "failed",
              code: "code" in outcome ? outcome.code : outcome.state, keepClaim: outcome.state === "paused" });
            return inspect(runId);
          }
          results.push({ blocked: outcome.result.blockedProbability, slur: outcome.result.slurProbability ?? null, vulgar: outcome.result.vulgarProbability ?? null });
        }
        const decision = averageDecision(results, thresholdsFor(material.configuration))!;
        const finalAuthorization = await current(material);
        await store.completeProduction(claim, { status: decision.disposition === "accept" ? "accepted" : "rejected",
          result: { id: randomUUID(), reuseIdentity: material.reuseIdentity, material: productionResultSchema.parse({ schema: "wordwell-production-appropriateness-v1",
            executionKind: material.executionKind, decision, trialAttemptIds: attemptIds, input: material.input, configurationFingerprint: stage.fingerprint,
            originalAssessmentId: authorization.assessmentId, bundleId: material.bundleId }) },
          assessmentId: finalAuthorization.assessmentId, promotionId: finalAuthorization.promotionId });
        // This slice stops at appropriateness. Later stages consume authorization.
        return inspect(runId);
      } finally { await claim.release(); }
    },
    async recover(runId: string) {
      const { run, material } = await load(runId);
      if (["accepted", "rejected", "failed"].includes(run.status)) {
        await reconcileTerminalAccounting(runId);
        if (await store.candidateClaim(run.candidateId) !== runId) return inspect(runId);
        const claim = await store.claimCandidate(run.candidateId, runId, true);
        try { await store.completeProduction(claim, { status: run.status as "accepted" | "rejected" | "failed", code: run.outcomeCode ?? undefined }); }
        finally { await claim.release(); }
        return inspect(runId);
      }
      await compatible(material);
      const claim = await store.claimCandidate(run.candidateId, runId, true).catch(error => {
        if (error instanceof PrivateError && error.code === "run_completed") return null;
        throw error;
      });
      if (!claim) return inspect(runId);
      try {
        const executor = createStageExecutor({ store, ledger: deps.ledger, model: deps.execution.model, settings: executionSettings(material.execution), sleep: deps.sleep });
        let failed: string | undefined;
        for (const trial of await store.productionTrials(runId)) {
          // Identity may have been assigned just before a crash. Nothing was sent.
          if (!await store.readAttempt(trial.attemptId)) continue;
          const outcome = await executor.execute({ runId, attemptId: trial.attemptId, stage: createAppropriatenessStage(material.configuration), input: material.input, allowDispatch: false, assertOwnership: claim.assert, ownership: claim });
          if (!["valid", "paused"].includes(outcome.state)) failed = "code" in outcome ? outcome.code : outcome.state;
        }
        await store.completeProduction(claim, { status: failed ? "failed" : "paused", code: failed ?? "recovered_without_dispatch" });
        return inspect(runId);
      } finally { await claim.release(); }
    },
    async authorizeDownstream(options: { bundleId: string; intake: PipelineConfig }) {
      const currentIntake = await authorizeScopedCandidate(deps.sources, options.bundleId, options.intake);
      const promotion = await requirePromotion(store, createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION).fingerprint);
      const selected = await store.selectedProductionResult(currentIntake.candidateId);
      if (!selected || selected.reuseIdentity !== await appropriatenessReuseIdentity(currentIntake.appropriatenessInput, APPROPRIATENESS_CONFIGURATION)) throw new PrivateError("appropriateness_not_current");
      const result = productionResultSchema.parse(selected.material);
      if (result.executionKind !== "live" || result.decision.disposition !== "accept") throw new PrivateError("appropriateness_not_accepted");
      // Verify all three linked shared-store trials rather than trusting a summary.
      for (const attemptId of result.trialAttemptIds) {
        const attempt = await store.readAttempt(attemptId);
        if (attempt?.status !== "valid" || attempt.runId !== selected.runId) throw new PrivateError("appropriateness_not_valid");
        resultSchema.parse(attempt.result);
      }
      return { ...currentIntake, resultId: selected.id, promotionId: promotion.id };
    }
  };
}
