import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fingerprint, pipelineConfigSchema, type PipelineConfig } from "./config.js";
import { createStageExecutor } from "./execution/executor.js";
import type { ModelAdapter } from "./execution/model.js";
import { requireLunaVerificationPolicy } from "./execution/openrouter.js";
import type { PrivateStore, CandidateClaim } from "./storage/postgres.js";
import { latestResponse } from "./storage/postgres.js";
import type { SourceStore } from "./storage/sources.js";
import type { ReceiptLedger } from "./storage/receipts.js";
import type { PlannerRevalidationStore } from "./storage/planner-revalidations.js";
import { PrivateError } from "./storage/crypto.js";
import { checkPlan, createPlannerStage, planSchema, plannerInputSchema, plannerConfigurationSchema, type PlannerConfiguration } from "./stages/planner.js";
import { plannerEvidence } from "./sources/planner.js";
import { LUNA_EXECUTION, lunaExecutionSchema, lunaExecutionSettings } from "./planner-config.js";
import { plannerImplementation, plannerReuseIdentity } from "./planner-identity.js";
import { requirePlannerPromotion } from "./planner-promotion.js";

const dependenciesSchema = z.object({ assessmentId: z.string(), appropriatenessResultId: z.uuid(), usefulnessResultId: z.uuid() }).strict();
export const plannerRunSchema = z.object({ schema: z.literal("wordwell-planner-run-v1"), stage: z.literal("planner"), mode: z.enum(["normal", "stage-only"]), fresh: z.boolean(),
  executionKind: z.enum(["live", "controlled"]), candidateId: z.uuid(), bundleId: z.string(), input: plannerInputSchema, configuration: plannerConfigurationSchema,
  intake: pipelineConfigSchema, execution: lunaExecutionSchema, implementation: z.string(), reuseIdentity: z.string(), originalDependencies: dependenciesSchema }).strict();
const resultSchema = z.object({ schema: z.literal("wordwell-production-planner-v1"), executionKind: z.enum(["live", "controlled"]), input: plannerInputSchema,
  configurationFingerprint: z.string(), attemptId: z.uuid(), originalDependencies: dependenciesSchema, plan: planSchema }).strict();
export type GateAuthorization = { candidateId: string; headword: string; bundleId: string; assessmentId: string; resultId: string; appropriatenessResultId?: string };
export function createPlannerCoordinator(deps: { store: PrivateStore; sources: SourceStore; ledger: ReceiptLedger; model: ModelAdapter; executionKind: "live" | "controlled";
  currentIntake: () => Promise<PipelineConfig>; authorizeGates: (bundleId: string, intake: PipelineConfig) => Promise<GateAuthorization>; beforeDispatch?: () => Promise<void>; sleep?: (ms: number) => Promise<void>; revalidations?: PlannerRevalidationStore }) {
  const { store } = deps;
  async function load(id: string) {
    const run = await store.readProductionRun(id);
    if (!run) throw new PrivateError("run_missing");
    return { run, material: plannerRunSchema.parse(run.material) };
  }
  async function current(bundleId: string, candidate?: string) {
    const intake = await deps.currentIntake(), gates = await deps.authorizeGates(bundleId, intake);
    if (!gates.appropriatenessResultId || candidate && candidate !== gates.headword) throw new PrivateError("planner_gate_authorization_invalid");
    return { intake, gates, input: plannerEvidence(bundleId, await deps.sources.readyBundle(bundleId)) };
  }
  async function validated(selected: NonNullable<Awaited<ReturnType<PrivateStore["selectedProductionResult"]>>>, expectedInput: z.infer<typeof plannerInputSchema>, config: PlannerConfiguration) {
    const result = resultSchema.parse(selected.material), stage = createPlannerStage(config, expectedInput), attempt = await store.readAttempt(result.attemptId), last = attempt?.requests.at(-1), reply = last ? latestResponse(last) : null;
    const raw = reply?.kind === "response" ? stage.validate(reply.body) : null;
    if (result.executionKind !== deps.executionKind || fingerprint(result.input) !== fingerprint(expectedInput) || result.configurationFingerprint !== stage.fingerprint ||
      attempt?.status !== "valid" || attempt.runId !== selected.runId || attempt.stage !== "planner" || fingerprint(attempt.input.request) !== fingerprint(stage.render(expectedInput)) ||
      fingerprint(attempt.input.provenance) !== fingerprint(result.originalDependencies) || !raw?.ok || fingerprint(raw.result) !== fingerprint(result.plan) || fingerprint(attempt.result) !== fingerprint(result.plan)) throw new PrivateError("planner_result_not_valid");
    return { ...result, plan: checkPlan(expectedInput, result.plan) };
  }
  async function inspect(id: string) {
    const { run, material } = await load(id);
    const trials = await store.productionTrials(id);
    return { ...run, material, selected: await store.selectedProductionResult(run.candidateId, "planner"),
      trials: await Promise.all(trials.map(async t => ({ ...t, attempt: await store.readAttempt(t.attemptId) }))),
      claimOwnerRunId: await store.candidateClaim(run.candidateId), authorizations: await store.productionAuthorizations(id), spend: await store.productionSpend(id) };
  }
  async function stopPendingAttempts(id: string, code: string, claim: CandidateClaim) {
    for (const trial of await store.productionTrials(id)) {
      const attempt = await store.readAttempt(trial.attemptId);
      if (attempt?.status === "pending" && attempt.requests.every(r => r.status === "abandoned" || r.status === "responded" && !r.retryable))
        await store.finishAttempt(trial.attemptId, { status: "failed", outcomeCode: code }, claim);
    }
  }
  return { inspect,
    async recover(id: string) {
      const report = await inspect(id), receipts = (await deps.ledger.read()).filter(r => r.runId === id);
      for (const trial of report.trials) for (const receipt of receipts) {
        if (receipt.type === "request_outcome" && receipt.chargeNanoUsd !== null && receipt.attemptId === trial.attemptId && trial.attempt?.requests.some(r => r.id === receipt.requestId))
          await store.reconcileRequestAccounting(receipt.requestId, { ...receipt, chargeNanoUsd: receipt.chargeNanoUsd });
      }
      if (["accepted", "rejected", "failed"].includes(report.status)) return inspect(id);
      const claim = await store.claimCandidate(report.candidateId, id, true);
      try {
        if (report.material.implementation !== await plannerImplementation()) throw new PrivateError("implementation_changed");
        requireLunaVerificationPolicy(deps.model, report.material.configuration);
        const stage = createPlannerStage(report.material.configuration, report.material.input);
        const executor = createStageExecutor({ store, ledger: deps.ledger, model: deps.model, sleep: deps.sleep,
          settings: lunaExecutionSettings(report.material.execution, report.material.configuration.maxOutputTokens) });
        let failure: string | undefined, pauseCode: string | undefined;
        // Restore accounting/raw outcomes before checking permission to generate.
        // Recovery may terminalize saved evidence but never send a replacement.
        for (const trial of report.trials) if (trial.attempt) {
          const outcome = await executor.execute({ runId: id, attemptId: trial.attemptId, stage, input: report.material.input,
            provenance: report.material.originalDependencies, allowDispatch: false, ownership: claim, assertOwnership: claim.assert });
          if (outcome.state === "paused" && ["accounting_unavailable", "storage_unavailable"].includes(outcome.code)) {
            // Accounting restoration is still blocked. Do not let revoked
            // generation permission turn recoverable reservations terminal.
            await store.completeProduction(claim, { status: "paused", code: outcome.code, keepClaim: true });
            return inspect(id);
          }
          if (outcome.state === "paused") pauseCode = outcome.code;
          if (!["valid", "paused"].includes(outcome.state)) failure = "code" in outcome ? outcome.code : outcome.state;
        }
        if (!failure) {
          try { await current(report.material.bundleId, report.material.input.headword); }
          catch (error) { failure = error instanceof PrivateError ? error.code : "planner_permission_unavailable"; }
        }
        if (failure) await stopPendingAttempts(id, failure, claim);
        await store.completeProduction(claim, { status: failure ? "failed" : "paused", code: failure ?? pauseCode ?? "recovered_without_dispatch", keepClaim: !failure });
        return inspect(id);
      } finally { await claim.release(); }
    },
    async dryRun(bundleId: string, candidate: string, config: PlannerConfiguration) {
      const checked = await current(bundleId, candidate), stage = createPlannerStage(config, checked.input);
      const identity = await plannerReuseIdentity(checked.input, config), selected = await store.selectedProductionResult(checked.gates.candidateId, "planner");
      return { ...checked, configuration: config, request: stage.render(checked.input), reuseIdentity: identity, selectedResultId: selected?.id ?? null,
        contentMatches: selected?.reuseIdentity === identity, ownerPromotion: await store.currentPlannerPromotion(stage.fingerprint),
        execution: LUNA_EXECUTION, reservationNanoUsd: lunaExecutionSettings(LUNA_EXECUTION, config.maxOutputTokens).reservationNanoUsd, modelCalls: 0 };
    },
    async create(options: { bundleId: string; candidate: string; configuration: PlannerConfiguration; capNanoUsd: number; fresh?: boolean; stageOnly?: boolean }) {
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
      const checked = await current(options.bundleId, options.candidate), config = plannerConfigurationSchema.parse(options.configuration);
      if (config.schema !== "wordwell-planner-configuration-v5") throw new PrivateError("planner_configuration_historical_only");
      if (deps.model.route !== config.route) throw new PrivateError("model_adapter_unavailable");
      requireLunaVerificationPolicy(deps.model, config);
      if (deps.executionKind === "live") await requirePlannerPromotion(store, createPlannerStage(config, checked.input).fingerprint, deps.revalidations);
      const id = randomUUID();
      await store.createProductionRun({ id, candidateId: checked.gates.candidateId, capNanoUsd: options.capNanoUsd,
        material: plannerRunSchema.parse({ schema: "wordwell-planner-run-v1", stage: "planner", mode: options.stageOnly ? "stage-only" : "normal", fresh: options.fresh ?? false,
          executionKind: deps.executionKind, candidateId: checked.gates.candidateId, bundleId: options.bundleId, input: checked.input, configuration: config,
          intake: checked.intake, execution: LUNA_EXECUTION, implementation: await plannerImplementation(), reuseIdentity: await plannerReuseIdentity(checked.input, config),
          originalDependencies: { assessmentId: checked.gates.assessmentId, appropriatenessResultId: checked.gates.appropriatenessResultId, usefulnessResultId: checked.gates.resultId } }) });
      return id;
    },
    async run(id: string, allowDispatch = true, recover = false) {
      const { run, material } = await load(id);
      if (["accepted", "rejected", "failed"].includes(run.status)) return inspect(id);
      if (material.executionKind !== deps.executionKind || material.implementation !== await plannerImplementation() || deps.model.route !== material.configuration.route) throw new PrivateError("implementation_changed");
      requireLunaVerificationPolicy(deps.model, material.configuration);
      const claim = await store.claimCandidate(run.candidateId, id, recover);
      try {
        const permissions = async () => {
          const checked = await current(material.bundleId, material.input.headword);
          if (checked.gates.candidateId !== run.candidateId || fingerprint(checked.input) !== fingerprint(material.input)) throw new PrivateError("planner_input_changed");
          const promotion = deps.executionKind === "live" ? await requirePlannerPromotion(store, createPlannerStage(material.configuration, material.input).fingerprint, deps.revalidations) : null;
          return { ...checked.gates, plannerPromotionId: promotion?.id };
        };
        await permissions();
        let selected = await store.selectedProductionResult(run.candidateId, "planner"), plan;
        let reused = false;
        if (!material.fresh && selected?.reuseIdentity === material.reuseIdentity) {
          plan = (await validated(selected, material.input, material.configuration)).plan; reused = true;
        } else {
          const stage = createPlannerStage(material.configuration, material.input), attemptId = await store.productionTrial(id, 1, "planner");
          const executor = createStageExecutor({ store, ledger: deps.ledger, model: deps.model, sleep: deps.sleep,
            settings: lunaExecutionSettings(material.execution, material.configuration.maxOutputTokens) });
          const outcome = await executor.execute({ runId: id, attemptId, stage, input: material.input, provenance: material.originalDependencies,
            allowDispatch, ownership: claim, assertOwnership: claim.assert, beforeDispatch: async () => { await permissions(); await deps.beforeDispatch?.(); await claim.assert(); } });
          if (outcome.state !== "valid") {
            await store.completeProduction(claim, { status: outcome.state === "paused" ? "paused" : "failed", keepClaim: outcome.state === "paused", code: "code" in outcome ? outcome.code : outcome.state });
            return inspect(id);
          }
          plan = checkPlan(material.input, outcome.result);
          selected = { id: randomUUID(), runId: id, reuseIdentity: material.reuseIdentity, material: resultSchema.parse({ schema: "wordwell-production-planner-v1", executionKind: deps.executionKind,
            input: material.input, configurationFingerprint: stage.fingerprint, attemptId, originalDependencies: material.originalDependencies, plan }) };
        }
        const authorization = await permissions();
        await store.completeProduction(claim, { stage: "planner", status: plan.meanings.length ? "accepted" : "rejected", code: plan.meanings.length ? undefined : "no_publishable_meanings",
          ...(reused ? { reusedResultId: selected!.id } : { result: selected! }), assessmentId: authorization.assessmentId, appropriatenessResultId: authorization.appropriatenessResultId,
          usefulnessResultId: authorization.resultId, plannerPromotionId: authorization.plannerPromotionId });
        return inspect(id);
      } catch (error) {
        if (error instanceof PrivateError && error.code !== "claim_stale") {
          let paused = ["storage_unavailable", "accounting_unavailable"].includes(error.code);
          // A thrown adapter/setup error can leave a durable dispatch intent.
          // Keep ownership for non-dispatching recovery of its reserved request.
          for (const trial of await store.productionTrials(id)) {
            if ((await store.readAttempt(trial.attemptId))?.requests.some(r => r.status === "reserved")) paused = true;
          }
          if (!paused) await stopPendingAttempts(id, error.code, claim);
          // Permission is unnecessary to stop an operation. The lock-owning
          // claim alone permits cleanup, so revoked gates cannot strand it.
          await store.completeProduction(claim, { status: paused ? "paused" : "failed", code: error.code, keepClaim: paused });
        }
        throw error;
      } finally { await claim.release(); }
    },
    async authorizeWriter(bundleId: string, config: PlannerConfiguration) {
      const checked = await current(bundleId), stage = createPlannerStage(config, checked.input), promotion = await requirePlannerPromotion(store, stage.fingerprint, deps.revalidations);
      const selected = await store.selectedProductionResult(checked.gates.candidateId, "planner");
      if (!selected || selected.reuseIdentity !== await plannerReuseIdentity(checked.input, config)) throw new PrivateError("planner_not_current");
      const result = await validated(selected, checked.input, config);
      if (result.executionKind !== "live" || !result.plan.meanings.length) throw new PrivateError("planner_not_publishable");
      return { ...checked.gates, plannerResultId: selected.id, plannerPromotionId: promotion.id, input: result.input, plan: result.plan };
    }
  };
}
