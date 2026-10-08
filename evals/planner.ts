import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createStageExecutor } from "../pipeline/execution/executor.js";
import type { ModelAdapter } from "../pipeline/execution/model.js";
import { createPlannerStage, checkPlan, plannerInputSchema, plannerConfigurationSchema, type PlannerConfiguration } from "../pipeline/stages/planner.js";
import { LUNA_EXECUTION, lunaExecutionSchema, lunaExecutionSettings } from "../pipeline/planner-config.js";
import { plannerImplementation } from "../pipeline/planner-identity.js";
import { fingerprint } from "../pipeline/config.js";
import { PrivateError } from "../pipeline/storage/crypto.js";
import type { PrivateStore } from "../pipeline/storage/postgres.js";
import { latestResponse } from "../pipeline/storage/postgres.js";
import type { ReceiptLedger } from "../pipeline/storage/receipts.js";
import { runTrial } from "./trials.js";
import { frozenPlannerSchema, plannerExpectationSchema, type FrozenPlannerDataset, type plannerManifestSchema } from "./datasets/planner.js";
import { plannerPromotionRuleIdentity } from "../pipeline/planner-promotion.js";

export const plannerEvaluationMaterial = z.object({ schema: z.literal("wordwell-planner-evaluation-v1"), configuration: plannerConfigurationSchema,
  execution: lunaExecutionSchema, implementation: z.string(), testedRuleIdentity: z.string(), datasetContentIdentity: z.string() }).strict();
export function createPlannerEvaluator(deps: { store: PrivateStore; ledger: ReceiptLedger; model: ModelAdapter; beforeDispatch?: () => Promise<void>; sleep?: (ms: number) => Promise<void> }) {
  const { store } = deps;
  async function load(id: string) {
    const experiment = await store.readExperiment(id);
    if (!experiment || experiment.stage !== "planner") throw new PrivateError("planner_experiment_missing");
    return { experiment, material: plannerEvaluationMaterial.parse(experiment.material) };
  }
  async function inspect(id: string) {
    const { experiment, material } = await load(id), cases = await store.readStageCases(id), expected = await store.readStageExpectations(id), trials = await store.listTrials(id);
    const outcomes = [];
    for (const c of cases) {
      const owner = z.object({ expectation: plannerExpectationSchema, split: z.enum(["development", "held-out"]), approval: z.unknown() }).strict().parse(expected.get(c.caseId));
      const input = plannerInputSchema.parse(c.input), expectation = owner.expectation;
      if (createPlannerStage(material.configuration, input).fingerprint !== experiment.configurationFingerprint) throw new PrivateError("planner_configuration_mismatch");
      for (let index = 1; index <= 3; index++) {
        const trial = trials.find(t => t.caseId === c.caseId && t.trialIndex === index), attempt = trial ? await store.readAttempt(trial.attemptId) : null;
        let contractPass = false, expectationPass: boolean | null = null;
        if (attempt?.status === "valid") {
          const stage = createPlannerStage(material.configuration, input), last = attempt.requests.at(-1), reply = last ? latestResponse(last) : null;
          const validation = reply?.kind === "response" ? stage.validate(reply.body) : null;
          if (attempt.experimentId !== id || attempt.stage !== "planner" || fingerprint(attempt.input.request) !== fingerprint(stage.render(input)) || !validation?.ok || fingerprint(validation.result) !== fingerprint(attempt.result)) throw new PrivateError("planner_evidence_mismatch");
          const plan = checkPlan(input, attempt.result); contractPass = true;
          expectationPass = expectation.requiredDefiningGroups.every(group => plan.meanings.some(m => fingerprint([...m.sense_ids].sort()) === fingerprint([...group].sort()))) &&
            plan.meanings.flatMap(m => m.usage_note_sense_ids).every(ref => expectation.allowedUsageNoteRefs.includes(ref)) &&
            plan.omitted_source_meanings.every(o => expectation.allowedOmissionRefs.includes(o.source_ref));
        }
        outcomes.push({ caseId: c.caseId, trialIndex: index, split: owner.split, input, expectation, attempt, contractPass, expectationPass });
      }
    }
    return { experimentId: id, configurationFingerprint: experiment.configurationFingerprint, material, outcomes,
       summary: { cases: cases.length, requiredTrials: cases.length * 3, validTrials: outcomes.filter(o => o.contractPass).length,
         verificationUnresolvedTrials: outcomes.filter(o => o.attempt?.status === "verification_unresolved").length,
         invalidContentTrials: outcomes.filter(o => o.attempt?.status === "invalid").length,
         rejectedRoutingTrials: outcomes.filter(o => o.attempt?.outcomeCode === "luna_routing_unverified").length,
         pendingTrials: outcomes.filter(o => o.attempt?.status === "pending").length, unstartedTrials: outcomes.filter(o => !o.attempt).length,
        expectationPasses: outcomes.filter(o => o.expectationPass).length, humanReviewRequired: true,
        splits: { development: outcomes.filter(o => o.split === "development").length / 3, heldOut: outcomes.filter(o => o.split === "held-out").length / 3 } }, spend: await store.spend(id) };
  }
  async function run(id: string, allowDispatch: boolean) {
    const { material } = await load(id);
    if (material.implementation !== await plannerImplementation()) throw new PrivateError("implementation_changed");
    const lock = await store.lockExperiment(id);
    try {
      const executor = createStageExecutor({ ...deps, settings: lunaExecutionSettings(material.execution, material.configuration.maxOutputTokens) });
      const trials = await store.listTrials(id);
      for (const c of await store.readStageCases(id)) {
        const input = plannerInputSchema.parse(c.input), stage = createPlannerStage(material.configuration, input);
        for (let trialIndex = 1; trialIndex <= 3; trialIndex++) {
          const trial = trials.find(t => t.caseId === c.caseId && t.trialIndex === trialIndex);
          if (!allowDispatch && !trial) continue;
          const prior = !allowDispatch && trial ? await store.readAttempt(trial.attemptId) : null;
          if (!allowDispatch && !prior) continue;
          const { outcome, previouslySaved } = allowDispatch
            ? await runTrial({ store, executor, stage, experimentId: id, caseId: c.caseId, trialIndex, input, ownership: lock, assertOwnership: lock.assert })
            : { outcome: await executor.execute({ experimentId: id, attemptId: trial!.attemptId, stage, input,
              ownership: lock, assertOwnership: lock.assert, allowDispatch: false }), previouslySaved: prior!.status !== "pending" };
           if (outcome.state === "paused" || outcome.state !== "valid" && outcome.state !== "verification_unresolved" && !previouslySaved ||
             (await store.spend(id)).unresolvedRequests > 0) return inspect(id);
        }
      }
      return inspect(id);
    } finally { await lock(); }
  }
  return { inspect, recover: (id: string) => run(id, false), run: (id: string) => run(id, true),
    async create(options: { dataset: FrozenPlannerDataset; manifest: z.infer<typeof plannerManifestSchema>; configuration: PlannerConfiguration; capNanoUsd: number }) {
      const dataset = frozenPlannerSchema.parse(options.dataset), config = plannerConfigurationSchema.parse(options.configuration);
      if (config.schema !== "wordwell-planner-configuration-v5") throw new PrivateError("planner_configuration_historical_only");
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
      const { contentIdentity, ...body } = dataset;
      // Fingerprint uses canonical JSON, while the frozen file uses its exact JSON bytes.
      const { digest } = await import("../pipeline/storage/crypto.js");
      if (digest(JSON.stringify(body)) !== contentIdentity || dataset.id !== options.manifest.id || dataset.version !== options.manifest.version) throw new PrivateError("dataset_identity_mismatch");
      if (deps.model.route !== config.route) throw new PrivateError("model_adapter_unavailable");
      const id = randomUUID(), implementation = await plannerImplementation();
      await store.createExperiment({ id, stage: "planner", dataset: { id: dataset.id, version: dataset.version, ciphertextSha256: options.manifest.ciphertextSha256 },
        configurationFingerprint: createPlannerStage(config, dataset.cases[0].input).fingerprint, implementationFingerprint: implementation, capNanoUsd: options.capNanoUsd,
        material: plannerEvaluationMaterial.parse({ schema: "wordwell-planner-evaluation-v1", configuration: config, execution: LUNA_EXECUTION, implementation,
          testedRuleIdentity: await plannerPromotionRuleIdentity(), datasetContentIdentity: contentIdentity }),
        stageCases: dataset.cases.map((c, position) => ({ caseId: c.id, position, input: c.input, expectation: { expectation: c.expectation, split: c.split ?? "development", approval: c.approval } })) });
      return id;
    }
  };
}
