import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createStageExecutor } from "../pipeline/execution/executor.js";
import type { ModelAdapter } from "../pipeline/execution/model.js";
import { createWriterStage, checkWrittenLesson, writerInputSchema, writerConfigurationSchema, type WriterConfiguration } from "../pipeline/stages/writer.js";
import { assembleWrittenLesson } from "../pipeline/sources/writer.js";
import { LUNA_EXECUTION, lunaExecutionSchema, lunaExecutionSettings } from "../pipeline/planner-config.js";
import { writerImplementation } from "../pipeline/writer-identity.js";
import { fingerprint } from "../pipeline/config.js";
import { digest, PrivateError } from "../pipeline/storage/crypto.js";
import type { PrivateStore } from "../pipeline/storage/postgres.js";
import { latestResponse } from "../pipeline/storage/postgres.js";
import type { ReceiptLedger } from "../pipeline/storage/receipts.js";
import { runTrial } from "./trials.js";
import { frozenWriterSchema, writerManifestSchema, writerExpectationSchema, type FrozenWriterDataset } from "./datasets/writer.js";
import { writerPromotionRuleIdentity } from "../pipeline/writer-promotion.js";

export const writerEvaluationMaterial = z.object({ schema: z.literal("wordwell-writer-evaluation-v1"), configuration: writerConfigurationSchema,
  execution: lunaExecutionSchema, implementation: z.string(), testedRuleIdentity: z.string(), datasetContentIdentity: z.string() }).strict();
export function createWriterEvaluator(deps: { store: PrivateStore; ledger: ReceiptLedger; model: ModelAdapter; beforeDispatch?: () => Promise<void>; sleep?: (ms: number) => Promise<void> }) {
  const { store } = deps;
  async function load(id: string) {
    const experiment = await store.readExperiment(id);
    if (!experiment || experiment.stage !== "writer") throw new PrivateError("writer_experiment_missing");
    return { experiment, material: writerEvaluationMaterial.parse(experiment.material) };
  }
  async function inspect(id: string) {
    const { experiment, material } = await load(id), cases = await store.readStageCases(id), expected = await store.readStageExpectations(id), trials = await store.listTrials(id);
    const outcomes = [];
    for (const c of cases) {
      const owner = z.object({ expectation: writerExpectationSchema, split: z.enum(["development", "held-out"]), approval: z.unknown() }).strict().parse(expected.get(c.caseId));
      const input = writerInputSchema.parse(c.input), stage = createWriterStage(material.configuration, input);
      if (stage.fingerprint !== experiment.configurationFingerprint) throw new PrivateError("writer_configuration_mismatch");
      for (let index = 1; index <= 3; index++) {
        const trial = trials.find(t => t.caseId === c.caseId && t.trialIndex === index), attempt = trial ? await store.readAttempt(trial.attemptId) : null;
        let contractPass = false, assembled = null;
        if (attempt?.status === "valid") {
          const last = attempt.requests.at(-1), reply = last ? latestResponse(last) : null, validation = reply?.kind === "response" ? stage.validate(reply.body) : null;
          if (attempt.experimentId !== id || attempt.stage !== "writer" || fingerprint(attempt.input.input) !== fingerprint(input) ||
            fingerprint(attempt.input.request) !== fingerprint(stage.render(input)) || !validation?.ok || fingerprint(validation.result) !== fingerprint(attempt.result)) throw new PrivateError("writer_evidence_mismatch");
          assembled = assembleWrittenLesson(input, checkWrittenLesson(input, attempt.result)); contractPass = true;
        }
        outcomes.push({ caseId: c.caseId, trialIndex: index, split: owner.split, input, expectation: owner.expectation, attempt, assembled, contractPass });
      }
    }
    return { experimentId: id, configurationFingerprint: experiment.configurationFingerprint, material, outcomes,
       summary: { cases: cases.length, requiredTrials: cases.length * 3, validTrials: outcomes.filter(o => o.contractPass).length, humanReviewRequired: true,
         verificationUnresolvedTrials: outcomes.filter(o => o.attempt?.status === "verification_unresolved").length,
         invalidContentTrials: outcomes.filter(o => o.attempt?.status === "invalid").length,
         rejectedRoutingTrials: outcomes.filter(o => o.attempt?.outcomeCode === "luna_routing_unverified").length,
         pendingTrials: outcomes.filter(o => o.attempt?.status === "pending").length, unstartedTrials: outcomes.filter(o => !o.attempt).length,
        splits: { development: outcomes.filter(o => o.split === "development").length / 3,
          heldOut: outcomes.filter(o => o.split === "held-out").length / 3 } }, spend: await store.spend(id) };
  }
  async function run(id: string, allowDispatch: boolean) {
    const { material } = await load(id);
    if (material.implementation !== await writerImplementation()) throw new PrivateError("implementation_changed");
    const lock = await store.lockExperiment(id);
    try {
      const executor = createStageExecutor({ ...deps, settings: lunaExecutionSettings(material.execution, material.configuration.maxOutputTokens) });
      const trials = await store.listTrials(id);
      for (const c of await store.readStageCases(id)) {
        const input = writerInputSchema.parse(c.input), stage = createWriterStage(material.configuration, input);
        for (let trialIndex = 1; trialIndex <= 3; trialIndex++) {
          const trial = trials.find(t => t.caseId === c.caseId && t.trialIndex === trialIndex);
          if (!allowDispatch && !trial) continue;
          const prior = !allowDispatch && trial ? await store.readAttempt(trial.attemptId) : null;
          if (!allowDispatch && !prior) continue;
          const { outcome, previouslySaved } = allowDispatch
            ? await runTrial({ store, executor, stage, experimentId: id, caseId: c.caseId, trialIndex, input, ownership: lock, assertOwnership: lock.assert })
            : { outcome: await executor.execute({ experimentId: id, attemptId: trial!.attemptId, stage, input, ownership: lock, assertOwnership: lock.assert, allowDispatch: false }), previouslySaved: prior!.status !== "pending" };
           if (outcome.state === "paused" || outcome.state !== "valid" && outcome.state !== "verification_unresolved" && !previouslySaved ||
             (await store.spend(id)).unresolvedRequests > 0) return inspect(id);
        }
      }
      return inspect(id);
    } finally { await lock(); }
  }
  return { inspect, recover: (id: string) => run(id, false), run: (id: string) => run(id, true),
    async create(options: { dataset: FrozenWriterDataset; manifest: z.infer<typeof writerManifestSchema>; configuration: WriterConfiguration; capNanoUsd: number }) {
       const dataset = frozenWriterSchema.parse(options.dataset), manifest = writerManifestSchema.parse(options.manifest), config = writerConfigurationSchema.parse(options.configuration);
       if (config.schema !== "wordwell-writer-configuration-v2") throw new PrivateError("writer_configuration_historical_only");
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
      const { contentIdentity, ...body } = dataset;
      if (digest(JSON.stringify(body)) !== contentIdentity || dataset.id !== manifest.id || dataset.version !== manifest.version) throw new PrivateError("dataset_identity_mismatch");
      if (new Set(dataset.cases.map(c => c.id)).size !== dataset.cases.length || new Set(dataset.cases.map(c => c.input.headword)).size !== dataset.cases.length) throw new PrivateError("dataset_membership_invalid");
      if (deps.model.route !== config.route) throw new PrivateError("model_adapter_unavailable");
      const id = randomUUID(), implementation = await writerImplementation();
      await store.createExperiment({ id, stage: "writer", dataset: { id: dataset.id, version: dataset.version, ciphertextSha256: manifest.ciphertextSha256 },
        configurationFingerprint: createWriterStage(config, dataset.cases[0].input).fingerprint, implementationFingerprint: implementation, capNanoUsd: options.capNanoUsd,
        material: writerEvaluationMaterial.parse({ schema: "wordwell-writer-evaluation-v1", configuration: config, execution: LUNA_EXECUTION, implementation,
          testedRuleIdentity: await writerPromotionRuleIdentity(), datasetContentIdentity: contentIdentity }),
        stageCases: dataset.cases.map((c, position) => ({ caseId: c.id, position, input: c.input, expectation: { expectation: c.expectation, split: c.split, approval: c.approval } })) });
      return id;
    }
  };
}
