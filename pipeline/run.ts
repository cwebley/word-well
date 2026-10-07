// Production coordination owns current permissions, candidate claims and
// selection. Every intentional trial goes through the existing executor.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fingerprint, type PipelineConfig } from "./config.js";
import { createStageExecutor } from "./execution/executor.js";
import type { ModelAdapter } from "./execution/model.js";
import { APPROPRIATENESS_CONFIGURATION, averageDecision, createAppropriatenessStage, thresholdsFor, TRIALS } from "./stages/appropriateness.js";
import { PrivateError } from "./storage/crypto.js";
import type { PrivateStore, CandidateClaim } from "./storage/postgres.js";
import type { SourceStore } from "./storage/sources.js";
import type { ReceiptLedger } from "./storage/receipts.js";
import { authorizeScopedCandidate } from "./sources/index.js";
import { appropriatenessReuseIdentity, usefulnessReuseIdentity, productionImplementation } from "./reuse.js";
import { executionSettings, runMaterialSchema, type RunMaterial } from "./production-config.js";
import type { LocalConfig } from "../evals/private-appropriateness.js";
import { requirePromotion } from "./promotion.js";
import { requireUsefulnessPromotion } from "./usefulness-promotion.js";
import { combineTrials, createUsefulnessStage, features, usefulnessConfiguration, usefulnessInputSchema, type Subject, type UsefulnessConfiguration } from "./stages/usefulness.js";
import { PRODUCTION_COMBINER } from "./stages/usefulness-production.js";
import type { StageDefinition } from "./execution/stage.js";

const decisionSchema = z.object({ blockedProbability: z.number().min(0).max(1), slurProbability: z.number().min(0).max(1).nullable(),
  vulgarProbability: z.number().min(0).max(1).nullable(), disposition: z.enum(["accept", "reject"]) }).strict();
export const productionResultSchema = z.object({ schema: z.literal("wordwell-production-appropriateness-v1"), executionKind: z.enum(["live", "controlled"]),
  trialAttemptIds: z.array(z.uuid()).length(3), decision: decisionSchema, input: z.object({ headword: z.string() }).strict(),
  configurationFingerprint: z.string(), originalAssessmentId: z.string().regex(/^[a-f0-9]{64}$/), bundleId: z.string() }).strict();
export const productionUsefulnessSchema = z.object({ schema: z.literal("wordwell-production-usefulness-v1"), executionKind: z.enum(["live", "controlled"]),
  trialAttemptIds: z.array(z.uuid()).length(3), input: usefulnessInputSchema, configurationFingerprint: z.string(),
  originalAssessmentId: z.string(), originalAppropriatenessResultId: z.uuid(), bundleId: z.string(),
  decision: z.object({ keepScore: z.number().min(0).max(1), verdict: z.enum(["advance", "exclude"]),
    averagedFeatures: z.record(z.string(), z.number()), configId: z.string() }).strict() }).strict();

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
  async function current(material: RunMaterial, stage = "appropriateness") {
    const authorization = await authorizeScopedCandidate(deps.sources, material.bundleId, await deps.currentIntake());
    if (authorization.candidateId !== material.candidateId || authorization.headword !== material.input.headword) throw new PrivateError("candidate_input_changed");
    if (material.usefulness && fingerprint(authorization.usefulnessInput) !== fingerprint(material.usefulness.input)) throw new PrivateError("candidate_input_changed");
    const promotion = material.executionKind !== "live" ? null : stage === "appropriateness"
      ? await requirePromotion(store, createAppropriatenessStage(material.configuration).fingerprint)
      : await requireUsefulnessPromotion(store, createUsefulnessStage(material.usefulness!.configuration).fingerprint);
    return { ...authorization, promotionId: promotion?.id };
  }
  async function compatible(material: RunMaterial) {
    if (material.implementation !== (deps.implementation ?? await productionImplementation())) throw new PrivateError("implementation_changed");
    if (material.executionKind !== deps.execution.kind) throw new PrivateError("execution_kind_mismatch");
    if (deps.execution.model.route !== material.configuration.route) throw new PrivateError("model_adapter_unavailable");
    if (await appropriatenessReuseIdentity(material.input, material.configuration) !== material.reuseIdentity) throw new PrivateError("reuse_identity_changed");
    if (material.usefulness && await usefulnessReuseIdentity(material.usefulness.input, material.usefulness.configuration, material.bundleId) !== material.usefulness.reuseIdentity) throw new PrivateError("reuse_identity_changed");
  }
  async function inspect(runId: string) {
    const { run, material } = await load(runId);
    const trials = await store.productionTrials(runId);
    return { ...run, material, claimOwnerRunId: await store.candidateClaim(run.candidateId),
      trials: await Promise.all(trials.map(async t => ({ ...t, attempt: await store.readAttempt(t.attemptId) }))),
      selected: await store.selectedProductionResult(run.candidateId), history: await store.productionHistory(run.candidateId),
      selectedUsefulness: await store.selectedProductionResult(run.candidateId, "usefulness"), authorizations: await store.productionAuthorizations(runId),
      spend: await store.productionSpend(runId) };
  }
  async function preceding(material: RunMaterial) {
    await current(material);
    return validatePreceding(material);
  }
  async function validatedTrial<Input, Result>(id: string, runId: string, stage: StageDefinition<Input, Result>, input: Input) {
    const attempt = await store.readAttempt(id), code = `${stage.name}_not_valid`;
    if (attempt?.status !== "valid" || attempt.runId !== runId || attempt.stage !== stage.name || fingerprint(attempt.input.request) !== fingerprint(stage.render(input))) throw new PrivateError(code);
    const parsed = stage.resultSchema.parse(attempt.result), reply = attempt.requests.at(-1)?.response;
    const validated = reply?.kind === "response" ? stage.validate(reply.body) : null;
    if (!validated?.ok || fingerprint(validated.result) !== fingerprint(parsed)) throw new PrivateError(code);
    return { attempt, result: parsed };
  }
  async function validatePreceding(material: Pick<RunMaterial, "candidateId" | "input" | "configuration" | "reuseIdentity" | "executionKind">) {
    const selected = await store.selectedProductionResult(material.candidateId);
    if (!selected || selected.reuseIdentity !== material.reuseIdentity) throw new PrivateError("appropriateness_not_current");
    const result = productionResultSchema.parse(selected.material);
    if (result.executionKind !== material.executionKind || result.decision.disposition !== "accept") throw new PrivateError("appropriateness_not_accepted");
    const stage = createAppropriatenessStage(material.configuration);
    if (result.configurationFingerprint !== stage.fingerprint || fingerprint(result.input) !== fingerprint(material.input)) throw new PrivateError("appropriateness_not_valid");
    const signals = [];
    for (const id of result.trialAttemptIds) {
      const { result: parsed } = await validatedTrial(id, selected.runId, stage, material.input);
      signals.push({ blocked: parsed.blockedProbability, slur: parsed.slurProbability ?? null, vulgar: parsed.vulgarProbability ?? null });
    }
    if (new Set(result.trialAttemptIds).size !== 3 || fingerprint(averageDecision(signals, thresholdsFor(material.configuration))) !== fingerprint(result.decision)) throw new PrivateError("appropriateness_not_valid");
    return selected;
  }
  async function validateUseful(selected: NonNullable<Awaited<ReturnType<PrivateStore["selectedProductionResult"]>>>, input: Subject, configuration: UsefulnessConfiguration) {
    const saved = productionUsefulnessSchema.parse(selected.material), stage = createUsefulnessStage(configuration), answers = [];
    if (saved.configurationFingerprint !== stage.fingerprint || fingerprint(saved.input) !== fingerprint(input)) throw new PrivateError("usefulness_not_valid");
    for (const id of saved.trialAttemptIds) {
      const { attempt, result: parsed } = await validatedTrial(id, selected.runId, stage, input);
      if (fingerprint(attempt.input.provenance) !== fingerprint({ appropriatenessResultId: saved.originalAppropriatenessResultId, assessmentId: saved.originalAssessmentId, bundleId: saved.bundleId })) throw new PrivateError("usefulness_provenance_invalid");
      answers.push(parsed.answers);
    }
    const combined = combineTrials(answers, configuration.combiner);
    if (new Set(saved.trialAttemptIds).size !== 3 || fingerprint(saved.decision) !== fingerprint({ keepScore: combined.keepScore, verdict: combined.verdict, configId: combined.configId, averagedFeatures: features(answers) })) throw new PrivateError("usefulness_not_valid");
    return saved;
  }
  async function trials<Input, Result>(runId: string, material: RunMaterial, claim: CandidateClaim, stage: StageDefinition<Input, Result>, input: Input, provenance?: unknown) {
    const executor = createStageExecutor({ store, ledger: deps.ledger, model: deps.execution.model, settings: executionSettings(material.execution), sleep: deps.sleep });
    const results: Result[] = [], attemptIds: string[] = [];
    for (let trialIndex = 1; trialIndex <= TRIALS; trialIndex++) {
      await claim.assert();
      const attemptId = await store.productionTrial(runId, trialIndex, stage.name);
      attemptIds.push(attemptId);
      const outcome = await executor.execute({ runId, attemptId, stage, input, provenance, assertOwnership: claim.assert, ownership: claim, beforeDispatch: async () => {
        await current(material, stage.name);
        if (stage.name === "usefulness") await preceding(material);
        await deps.beforeDispatch?.(); await claim.assert();
      } });
      if (outcome.state !== "valid") {
        await store.completeProduction(claim, { status: outcome.state === "paused" ? "paused" : "failed",
          code: "code" in outcome ? outcome.code : outcome.state, keepClaim: outcome.state === "paused" });
        return null;
      }
      results.push(outcome.result);
    }
    return { results, attemptIds };
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
    async create(options: { bundleId: string; candidate: string; intake: PipelineConfig; config: LocalConfig; capNanoUsd: number; fresh?: boolean; stageOnly?: boolean; stage?: "appropriateness" | "usefulness" }) {
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
      const authorization = await authorizeScopedCandidate(deps.sources, options.bundleId, options.intake);
      if (authorization.headword !== options.candidate) throw new PrivateError("candidate_outside_bundle_scope");
      const stage = createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION);
      const only = options.stage ?? "appropriateness";
      if (options.stage && !options.stageOnly) throw new PrivateError("production_mode_invalid");
      const usefulness = usefulnessConfiguration(PRODUCTION_COMBINER);
      const throughUsefulness = !options.stageOnly || only === "usefulness";
      if (deps.execution.kind === "live") {
        await requirePromotion(store, stage.fingerprint);
        if (throughUsefulness) await requireUsefulnessPromotion(store, createUsefulnessStage(usefulness).fingerprint);
        if (options.config.pricing.status !== "verified") throw new PrivateError("pricing_unverified");
      }
      const id = randomUUID();
      const material = runMaterialSchema.parse({ schema: "wordwell-production-run-v1", stage: only, mode: options.stageOnly ? "stage-only" : "normal",
        fresh: options.fresh ?? false, executionKind: deps.execution.kind, bundleId: options.bundleId, candidateId: authorization.candidateId,
        lessonId: authorization.lessonId, assessmentId: authorization.assessmentId, input: authorization.appropriatenessInput,
        intake: options.intake, configuration: stage.configuration, execution: options.config,
        implementation: deps.implementation ?? await productionImplementation(), reuseIdentity: await appropriatenessReuseIdentity(authorization.appropriatenessInput, APPROPRIATENESS_CONFIGURATION),
        ...(throughUsefulness ? { usefulness: { input: authorization.usefulnessInput, configuration: usefulness,
          reuseIdentity: await usefulnessReuseIdentity(authorization.usefulnessInput, usefulness, options.bundleId) } } : {}) });
      if (options.stageOnly && only === "usefulness") await preceding(material);
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
        // Resume recognizes this run's completed gate even in fresh-all mode.
        // Its immutable authorization is the checkpoint, not a new fresh trial.
        const selected = await store.selectedProductionResult(run.candidateId);
        const checkpoint = (await store.productionAuthorizations(runId)).some(a => a.stage === "appropriateness");
        const matching = selected?.reuseIdentity === material.reuseIdentity && productionResultSchema.parse(selected.material).executionKind === material.executionKind;
        if (checkpoint && !matching) throw new PrivateError("appropriateness_not_current");
        const reuseAppropriateness = matching && (!material.fresh || checkpoint);
        if (material.stage === "appropriateness" && reuseAppropriateness) {
          const saved = productionResultSchema.parse(selected.material);
          if (saved.executionKind === material.executionKind) {
            await store.completeProduction(claim, { status: saved.decision.disposition === "accept" ? "accepted" : "rejected",
              reusedResultId: selected.id, assessmentId: authorization.assessmentId, promotionId: authorization.promotionId,
              continuing: !!material.usefulness && saved.decision.disposition === "accept", keepClaim: !!material.usefulness && saved.decision.disposition === "accept" });
            if (!material.usefulness || saved.decision.disposition === "reject") return inspect(runId);
          }
        }
        if (material.stage === "appropriateness" && !reuseAppropriateness) {
          const stage = createAppropriatenessStage(material.configuration);
          const judged = await trials(runId, material, claim, stage, material.input);
          if (!judged) return inspect(runId);
          const decision = averageDecision(judged.results.map(r => ({ blocked: r.blockedProbability, slur: r.slurProbability ?? null, vulgar: r.vulgarProbability ?? null })), thresholdsFor(material.configuration))!;
          const finalAuthorization = await current(material);
          await store.completeProduction(claim, { status: decision.disposition === "accept" ? "accepted" : "rejected",
            result: { id: randomUUID(), reuseIdentity: material.reuseIdentity, material: productionResultSchema.parse({ schema: "wordwell-production-appropriateness-v1",
              executionKind: material.executionKind, decision, trialAttemptIds: judged.attemptIds, input: material.input, configurationFingerprint: stage.fingerprint,
              originalAssessmentId: authorization.assessmentId, bundleId: material.bundleId }) },
            assessmentId: finalAuthorization.assessmentId, promotionId: finalAuthorization.promotionId,
            continuing: !!material.usefulness && decision.disposition === "accept", keepClaim: !!material.usefulness && decision.disposition === "accept" });
          if (!material.usefulness || decision.disposition === "reject") return inspect(runId);
        }
        if (material.usefulness) {
          const previous = await preceding(material), permission = await current(material, "usefulness");
          const selected = !material.fresh ? await store.selectedProductionResult(run.candidateId, "usefulness") : null;
          if (selected?.reuseIdentity === material.usefulness.reuseIdentity && productionUsefulnessSchema.parse(selected.material).executionKind === material.executionKind) {
            const saved = await validateUseful(selected, material.usefulness.input, material.usefulness.configuration);
            await store.completeProduction(claim, { status: saved.decision.verdict === "advance" ? "accepted" : "rejected", stage: "usefulness",
              reusedResultId: selected.id, assessmentId: permission.assessmentId, promotionId: permission.promotionId, appropriatenessResultId: previous.id });
          } else {
            const stage = createUsefulnessStage(material.usefulness.configuration);
            const firstTrial = (await store.productionTrials(runId)).find(t => t.stage === "usefulness" && t.trialIndex === 1);
            const firstAttempt = firstTrial ? await store.readAttempt(firstTrial.attemptId) : null;
            const provenance = z.object({ appropriatenessResultId: z.uuid(), assessmentId: z.string(), bundleId: z.string() }).strict().parse(
              firstAttempt?.input.provenance ?? { appropriatenessResultId: previous.id, assessmentId: permission.assessmentId, bundleId: material.bundleId });
            const judged = await trials(runId, material, claim, stage, material.usefulness.input, provenance);
            if (!judged) return inspect(runId);
            const combined = combineTrials(judged.results.map(r => r.answers), material.usefulness.configuration.combiner);
            const latest = await preceding(material), finalPermission = await current(material, "usefulness");
            if (latest.id !== previous.id) throw new PrivateError("appropriateness_changed");
            await store.completeProduction(claim, { status: combined.verdict === "advance" ? "accepted" : "rejected", stage: "usefulness",
              result: { id: randomUUID(), reuseIdentity: material.usefulness.reuseIdentity, material: productionUsefulnessSchema.parse({ schema: "wordwell-production-usefulness-v1",
                executionKind: material.executionKind, trialAttemptIds: judged.attemptIds, input: material.usefulness.input, configurationFingerprint: stage.fingerprint,
                originalAssessmentId: provenance.assessmentId, originalAppropriatenessResultId: provenance.appropriatenessResultId, bundleId: provenance.bundleId,
                decision: { keepScore: combined.keepScore, verdict: combined.verdict, configId: combined.configId, averagedFeatures: features(judged.results.map(r => r.answers)) } }) },
              assessmentId: finalPermission.assessmentId, promotionId: finalPermission.promotionId, appropriatenessResultId: latest.id });
          }
        }
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
          const ownership = { runId, attemptId: trial.attemptId, allowDispatch: false, assertOwnership: claim.assert, ownership: claim };
          const outcome = trial.stage === "usefulness" && material.usefulness
            ? await executor.execute({ ...ownership, stage: createUsefulnessStage(material.usefulness.configuration), input: material.usefulness.input })
            : await executor.execute({ ...ownership, stage: createAppropriatenessStage(material.configuration), input: material.input });
          if (!["valid", "paused"].includes(outcome.state)) failed = "code" in outcome ? outcome.code : outcome.state;
        }
        await store.completeProduction(claim, { status: failed ? "failed" : "paused", code: failed ?? "recovered_without_dispatch" });
        return inspect(runId);
      } finally { await claim.release(); }
    },
    async authorizeDownstream(options: { bundleId: string; intake: PipelineConfig; stage?: "appropriateness" | "usefulness" }) {
      const currentIntake = await authorizeScopedCandidate(deps.sources, options.bundleId, options.intake);
      const promotion = await requirePromotion(store, createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION).fingerprint);
      const selected = await validatePreceding({ candidateId: currentIntake.candidateId, input: currentIntake.appropriatenessInput,
        configuration: APPROPRIATENESS_CONFIGURATION, executionKind: "live", reuseIdentity: await appropriatenessReuseIdentity(currentIntake.appropriatenessInput, APPROPRIATENESS_CONFIGURATION) });
      if (options.stage === "appropriateness") return { ...currentIntake, resultId: selected.id, promotionId: promotion.id };
      const config = usefulnessConfiguration(PRODUCTION_COMBINER), stage = createUsefulnessStage(config);
      const usefulPromotion = await requireUsefulnessPromotion(store, stage.fingerprint);
      const useful = await store.selectedProductionResult(currentIntake.candidateId, "usefulness");
      if (!useful || useful.reuseIdentity !== await usefulnessReuseIdentity(currentIntake.usefulnessInput, config, options.bundleId)) throw new PrivateError("usefulness_not_current");
      const saved = await validateUseful(useful, currentIntake.usefulnessInput, config);
      if (saved.executionKind !== "live" || saved.decision.verdict !== "advance") throw new PrivateError("usefulness_not_accepted");
      return { ...currentIntake, resultId: useful.id, promotionId: usefulPromotion.id, appropriatenessResultId: selected.id, appropriatenessPromotionId: promotion.id };
    }
  };
}
