import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fingerprint, pipelineConfigSchema, type PipelineConfig } from "./config.js";
import { createStageExecutor } from "./execution/executor.js";
import type { ModelAdapter } from "./execution/model.js";
import type { CandidateClaim } from "./storage/postgres.js";
import { latestResponse } from "./storage/postgres.js";
import type { WriterStore } from "./storage/writer.js";
import type { SourceStore } from "./storage/sources.js";
import type { ReceiptLedger } from "./storage/receipts.js";
import { PrivateError } from "./storage/crypto.js";
import { checkWrittenLesson, createWriterStage, writerResultSchema, writerInputSchema, writerConfigurationSchema, type WriterConfiguration, type WriterInput } from "./stages/writer.js";
import type { LessonPlan, PlannerInput } from "./stages/planner.js";
import { writerEvidence, assembleWrittenLesson } from "./sources/writer.js";
import { LUNA_EXECUTION, lunaExecutionSchema, lunaExecutionSettings } from "./planner-config.js";
import { writerImplementation, writerReuseIdentity } from "./writer-identity.js";
import { requireWriterPromotion } from "./writer-promotion.js";

const dependenciesSchema = z.object({ assessmentId: z.string(), appropriatenessResultId: z.uuid(), usefulnessResultId: z.uuid(), plannerResultId: z.uuid() }).strict();
export const writerRunSchema = z.object({ schema: z.literal("wordwell-writer-run-v1"), stage: z.literal("writer"), mode: z.enum(["normal", "stage-only"]), fresh: z.boolean(),
  executionKind: z.enum(["live", "controlled"]), candidateId: z.uuid(), bundleId: z.string(), input: writerInputSchema, configuration: writerConfigurationSchema,
  intake: pipelineConfigSchema, execution: lunaExecutionSchema, implementation: z.string(), reuseIdentity: z.string(), originalDependencies: dependenciesSchema }).strict();
const resultSchema = z.object({ schema: z.literal("wordwell-production-writer-v1"), executionKind: z.enum(["live", "controlled"]), input: writerInputSchema,
  configurationFingerprint: z.string(), attemptId: z.uuid(), originalDependencies: dependenciesSchema, written: writerResultSchema, assembled: z.unknown() }).strict();
export type PlanAuthorization = { candidateId: string; headword: string; bundleId: string; assessmentId: string; usefulnessResultId: string; appropriatenessResultId?: string;
  plannerResultId: string; plannerPromotionId?: string; input: PlannerInput; plan: LessonPlan };
export function createWriterCoordinator(deps: { store: WriterStore; sources: SourceStore; ledger: ReceiptLedger; model: ModelAdapter; executionKind: "live" | "controlled";
  currentIntake: () => Promise<PipelineConfig>; authorizePlan: (bundleId: string, intake: PipelineConfig) => Promise<PlanAuthorization>; beforeDispatch?: () => Promise<void>; sleep?: (ms: number) => Promise<void> }) {
  const { store } = deps;
  async function load(id: string) {
    const run = await store.readProductionRun(id);
    if (!run) throw new PrivateError("run_missing");
    return { run, material: writerRunSchema.parse(run.material) };
  }
  async function current(bundleId: string, candidate?: string) {
    const intake = await deps.currentIntake(), authorization = await deps.authorizePlan(bundleId, intake);
    if (!authorization.appropriatenessResultId || candidate && candidate !== authorization.headword || authorization.bundleId !== bundleId) throw new PrivateError("writer_plan_authorization_invalid");
    const input = writerEvidence(bundleId, await deps.sources.readyBundle(bundleId), authorization.input, authorization.plan);
    return { intake, authorization, input };
  }
  async function validated(selected: NonNullable<Awaited<ReturnType<WriterStore["selectedProductionResult"]>>>, input: WriterInput, config: WriterConfiguration) {
    const result = resultSchema.parse(selected.material), stage = createWriterStage(config, input), attempt = await store.readAttempt(result.attemptId), last = attempt?.requests.at(-1), reply = last ? latestResponse(last) : null;
    const raw = reply?.kind === "response" ? stage.validate(reply.body) : null;
    if (result.executionKind !== deps.executionKind || fingerprint(result.input) !== fingerprint(input) || result.configurationFingerprint !== stage.fingerprint ||
      attempt?.status !== "valid" || attempt.runId !== selected.runId || attempt.stage !== "writer" || fingerprint(attempt.input.input) !== fingerprint(input) ||
      fingerprint(attempt.input.request) !== fingerprint(stage.render(input)) || fingerprint(attempt.input.provenance) !== fingerprint(result.originalDependencies) ||
      !raw?.ok || fingerprint(raw.result) !== fingerprint(result.written) || fingerprint(attempt.result) !== fingerprint(result.written) ||
      fingerprint(result.assembled) !== fingerprint(assembleWrittenLesson(input, result.written))) throw new PrivateError("writer_result_not_valid");
    return result;
  }
  async function inspect(id: string) {
    const { run, material } = await load(id), trials = await store.productionTrials(id);
    return { ...run, material, selected: await store.selectedProductionResult(run.candidateId, "writer"),
      trials: await Promise.all(trials.map(async t => ({ ...t, attempt: await store.readAttempt(t.attemptId) }))),
      claimOwnerRunId: await store.candidateClaim(run.candidateId), authorizations: await store.writerAuthorizations(id), spend: await store.productionSpend(id) };
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
        if (report.material.executionKind !== deps.executionKind || report.material.implementation !== await writerImplementation()) throw new PrivateError("implementation_changed");
        const stage = createWriterStage(report.material.configuration, report.material.input);
        const executor = createStageExecutor({ store, ledger: deps.ledger, model: deps.model, sleep: deps.sleep,
          settings: lunaExecutionSettings(report.material.execution, report.material.configuration.maxOutputTokens) });
        let failure: string | undefined, pauseCode: string | undefined;
        for (const trial of report.trials) if (trial.attempt) {
          const outcome = await executor.execute({ runId: id, attemptId: trial.attemptId, stage, input: report.material.input,
            provenance: report.material.originalDependencies, allowDispatch: false, ownership: claim, assertOwnership: claim.assert });
          if (outcome.state === "paused" && ["accounting_unavailable", "storage_unavailable"].includes(outcome.code)) {
            await store.completeProduction(claim, { status: "paused", code: outcome.code, keepClaim: true });
            return inspect(id);
          }
          if (outcome.state === "paused") pauseCode = outcome.code;
          if (!["valid", "paused"].includes(outcome.state)) failure = "code" in outcome ? outcome.code : outcome.state;
        }
        if (!failure) {
          try {
            const checked = await current(report.material.bundleId, report.material.input.headword);
            if (fingerprint(checked.input) !== fingerprint(report.material.input)) throw new PrivateError("writer_input_changed");
          } catch (error) { failure = error instanceof PrivateError ? error.code : "writer_permission_unavailable"; }
        }
        if (failure) await stopPendingAttempts(id, failure, claim);
        await store.completeProduction(claim, { status: failure ? "failed" : "paused", code: failure ?? pauseCode ?? "recovered_without_dispatch", keepClaim: !failure });
        return inspect(id);
      } finally { await claim.release(); }
    },
    async dryRun(bundleId: string, candidate: string, config: WriterConfiguration) {
      const checked = await current(bundleId, candidate), stage = createWriterStage(config, checked.input);
      const identity = await writerReuseIdentity(checked.input, config), selected = await store.selectedProductionResult(checked.authorization.candidateId, "writer");
      return { ...checked, configuration: config, request: stage.render(checked.input), reuseIdentity: identity, selectedResultId: selected?.id ?? null,
        contentMatches: selected?.reuseIdentity === identity, ownerPromotion: await store.currentWriterPromotion(stage.fingerprint), execution: LUNA_EXECUTION,
        reservationNanoUsd: lunaExecutionSettings(LUNA_EXECUTION, config.maxOutputTokens).reservationNanoUsd, modelCalls: 0 };
    },
    async create(options: { bundleId: string; candidate: string; configuration: WriterConfiguration; capNanoUsd: number; fresh?: boolean; stageOnly?: boolean }) {
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
       const checked = await current(options.bundleId, options.candidate), config = writerConfigurationSchema.parse(options.configuration);
       if (config.schema !== "wordwell-writer-configuration-v2") throw new PrivateError("writer_configuration_historical_only");
      if (deps.model.route !== config.route) throw new PrivateError("model_adapter_unavailable");
      if (deps.executionKind === "live") await requireWriterPromotion(store, createWriterStage(config, checked.input).fingerprint);
      const id = randomUUID();
      await store.createProductionRun({ id, candidateId: checked.authorization.candidateId, capNanoUsd: options.capNanoUsd,
        material: writerRunSchema.parse({ schema: "wordwell-writer-run-v1", stage: "writer", mode: options.stageOnly ? "stage-only" : "normal", fresh: options.fresh ?? false,
          executionKind: deps.executionKind, candidateId: checked.authorization.candidateId, bundleId: options.bundleId, input: checked.input, configuration: config,
          intake: checked.intake, execution: LUNA_EXECUTION, implementation: await writerImplementation(), reuseIdentity: await writerReuseIdentity(checked.input, config),
          originalDependencies: { assessmentId: checked.authorization.assessmentId, appropriatenessResultId: checked.authorization.appropriatenessResultId,
            usefulnessResultId: checked.authorization.usefulnessResultId, plannerResultId: checked.authorization.plannerResultId } }) });
      return id;
    },
    async run(id: string, allowDispatch = true, recover = false) {
      const { run, material } = await load(id);
      if (["accepted", "rejected", "failed"].includes(run.status)) return inspect(id);
      if (material.executionKind !== deps.executionKind || material.implementation !== await writerImplementation() || deps.model.route !== material.configuration.route) throw new PrivateError("implementation_changed");
      const claim = await store.claimCandidate(run.candidateId, id, recover);
      try {
        const permissions = async () => {
          const checked = await current(material.bundleId, material.input.headword);
          if (checked.authorization.candidateId !== run.candidateId || fingerprint(checked.input) !== fingerprint(material.input)) throw new PrivateError("writer_input_changed");
          const promotion = deps.executionKind === "live" ? await requireWriterPromotion(store, createWriterStage(material.configuration, material.input).fingerprint) : null;
          return { assessmentId: checked.authorization.assessmentId, appropriatenessResultId: checked.authorization.appropriatenessResultId!, usefulnessResultId: checked.authorization.usefulnessResultId,
            plannerResultId: checked.authorization.plannerResultId, plannerPromotionId: checked.authorization.plannerPromotionId, writerPromotionId: promotion?.id };
        };
        await permissions();
        let selected = await store.selectedProductionResult(run.candidateId, "writer"), reused = false;
        if (!material.fresh && selected?.reuseIdentity === material.reuseIdentity) {
          await validated(selected, material.input, material.configuration); reused = true;
        } else {
          const stage = createWriterStage(material.configuration, material.input), attemptId = await store.productionTrial(id, 1, "writer");
          const executor = createStageExecutor({ store, ledger: deps.ledger, model: deps.model, sleep: deps.sleep,
            settings: lunaExecutionSettings(material.execution, material.configuration.maxOutputTokens) });
          const outcome = await executor.execute({ runId: id, attemptId, stage, input: material.input, provenance: material.originalDependencies,
            allowDispatch, ownership: claim, assertOwnership: claim.assert, beforeDispatch: async () => { await permissions(); await deps.beforeDispatch?.(); await permissions(); await claim.assert(); } });
          if (outcome.state !== "valid") {
            await store.completeProduction(claim, { status: outcome.state === "paused" ? "paused" : "failed", keepClaim: outcome.state === "paused", code: "code" in outcome ? outcome.code : outcome.state });
            return inspect(id);
          }
          const written = checkWrittenLesson(material.input, outcome.result);
          selected = { id: randomUUID(), runId: id, reuseIdentity: material.reuseIdentity, material: resultSchema.parse({ schema: "wordwell-production-writer-v1", executionKind: deps.executionKind,
            input: material.input, configurationFingerprint: stage.fingerprint, attemptId, originalDependencies: material.originalDependencies, written, assembled: assembleWrittenLesson(material.input, written) }) };
        }
        await store.completeWriter(claim, { ...(reused ? { reusedResultId: selected!.id } : { result: selected! }), authorization: await permissions() });
        return inspect(id);
      } catch (error) {
        if (error instanceof PrivateError && error.code !== "claim_stale") {
          let paused = ["storage_unavailable", "accounting_unavailable"].includes(error.code);
          for (const trial of await store.productionTrials(id)) if ((await store.readAttempt(trial.attemptId))?.requests.some(r => r.status === "reserved")) paused = true;
          if (!paused) await stopPendingAttempts(id, error.code, claim);
          await store.completeProduction(claim, { status: paused ? "paused" : "failed", code: error.code, keepClaim: paused });
        }
        throw error;
      } finally { await claim.release(); }
    },
    async authorizePublication(bundleId: string, config: WriterConfiguration) {
      const checked = await current(bundleId), stage = createWriterStage(config, checked.input), promotion = await requireWriterPromotion(store, stage.fingerprint);
      const selected = await store.selectedProductionResult(checked.authorization.candidateId, "writer");
      if (!selected || selected.reuseIdentity !== await writerReuseIdentity(checked.input, config)) throw new PrivateError("writer_not_current");
      const result = await validated(selected, checked.input, config);
      if (result.executionKind !== "live") throw new PrivateError("writer_not_publishable");
      return { ...checked.authorization, writerResultId: selected.id, writerPromotionId: promotion.id, writerInput: result.input, written: result.written, assembled: result.assembled };
    }
  };
}
