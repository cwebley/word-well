// Direct frozen-stage evaluation. No intake, promotions or production selections.
// Execution and accounting are the same as the production gate.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createStageExecutor } from "../pipeline/execution/executor.js";
import type { ModelAdapter } from "../pipeline/execution/model.js";
import { combineTrials, createUsefulnessStage, usefulnessConfiguration, usefulnessConfigurationSchema, usefulnessInputSchema, usefulnessTrialSchema, type Combiner } from "../pipeline/stages/usefulness.js";
import type { PrivateStore } from "../pipeline/storage/postgres.js";
import type { ReceiptLedger } from "../pipeline/storage/receipts.js";
import { PrivateError } from "../pipeline/storage/crypto.js";
import { fingerprint } from "../pipeline/config.js";
import { executionSettings } from "../pipeline/production-config.js";
import { loadLocalConfig, type LocalConfig } from "./private-appropriateness.js";
import { usefulnessCase, type UsefulnessDataset } from "./datasets/usefulness.js";
import { scoreUsefulness, type ScoredRow } from "./scorers/usefulness.js";
import { runTrial } from "./trials.js";

const materialSchema = z.object({ schema: z.literal("wordwell-durable-usefulness-evaluation-v1"), configuration: usefulnessConfigurationSchema,
  execution: z.unknown().transform(loadLocalConfig), implementation: z.string(),
  dataset: z.object({ name: z.string(), split: z.enum(["development", "held_out"]), version: z.string() }).strict() }).strict();
export async function usefulnessEvaluationImplementation() {
  const paths = ["./durable-usefulness.ts", "./datasets/usefulness.ts", "./scorers/usefulness.ts", "../pipeline/stages/usefulness.ts",
    "../pipeline/stages/usefulness-questions.json", "./trials.ts", "../pipeline/production-config.ts", "./private-appropriateness.ts",
    "../pipeline/execution/jev.ts", "../pipeline/execution/executor.ts", "../pipeline/execution/model.ts", "../pipeline/execution/stage.ts",
    "../pipeline/execution/system-one.ts", "../pipeline/storage/postgres.ts", "../pipeline/storage/receipts.ts", "../pipeline/storage/files.ts", "../pipeline/storage/crypto.ts", "../package-lock.json"];
  return fingerprint(await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))));
}
export function createDurableUsefulnessEvaluator(deps: { store: PrivateStore; ledger: ReceiptLedger; model: ModelAdapter;
  beforeDispatch?: () => Promise<void>; sleep?: (ms: number) => Promise<void> }) {
  const { store } = deps;
  async function load(id: string) {
    const experiment = await store.readExperiment(id);
    if (!experiment || experiment.stage !== "usefulness") throw new PrivateError("usefulness_experiment_missing");
    return { experiment, material: materialSchema.parse(experiment.material) };
  }
  async function inspect(id: string) {
    const { material } = await load(id), cases = await store.readStageCases(id), expected = await store.readStageExpectations(id);
    const trials = await store.listTrials(id), rows: ScoredRow[] = [], outcomes = [];
    for (const c of cases) {
      const input = usefulnessInputSchema.parse(c.input), owner = usefulnessCase.parse(expected.get(c.caseId));
      if (owner.headword !== input.headword || fingerprint(owner.partsOfSpeech) !== fingerprint(input.partsOfSpeech)) throw new PrivateError("frozen_input_mismatch");
      const attempts = await Promise.all([1, 2, 3].map(async index => {
        const t = trials.find(t => t.caseId === c.caseId && t.trialIndex === index);
        return t ? store.readAttempt(t.attemptId) : null;
      }));
      outcomes.push({ caseId: c.caseId, attempts });
      rows.push({ case: owner, result: attempts.every(a => a?.status === "valid")
        ? combineTrials(attempts.map(a => usefulnessTrialSchema.parse(a!.result).answers), material.configuration.combiner) : null });
    }
    return { experimentId: id, dataset: material.dataset, rows, report: scoreUsefulness(rows), outcomes, spend: await store.spend(id) };
  }
  return {
    inspect,
    async create(options: { dataset: UsefulnessDataset; combiner: Combiner; config: LocalConfig; capNanoUsd: number }) {
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
      const execution = loadLocalConfig(options.config);
      if (execution.pricing.status !== "verified") throw new PrivateError("pricing_unverified");
      const id = randomUUID(), configuration = usefulnessConfiguration(options.combiner);
      const { cases, ...dataset } = options.dataset;
      await store.createExperiment({ id, stage: "usefulness", dataset: { id: randomUUID(), version: 1, ciphertextSha256: dataset.version },
        configurationFingerprint: createUsefulnessStage(configuration).fingerprint, implementationFingerprint: await usefulnessEvaluationImplementation(), capNanoUsd: options.capNanoUsd,
        material: materialSchema.parse({ schema: "wordwell-durable-usefulness-evaluation-v1", configuration, execution, implementation: await usefulnessEvaluationImplementation(), dataset }),
        stageCases: cases.map((value, position) => { const c = usefulnessCase.parse(value); return { caseId: randomUUID(), position,
          input: usefulnessInputSchema.parse({ headword: c.headword, partsOfSpeech: c.partsOfSpeech }), expectation: c }; }) });
      return id;
    },
    async run(id: string) {
      const { material, experiment } = await load(id);
      if (material.implementation !== await usefulnessEvaluationImplementation()) throw new PrivateError("implementation_changed");
      if (experiment.finalizedAt) throw new PrivateError("experiment_finalized");
      const lock = await store.lockExperiment(id);
      try {
        const stage = createUsefulnessStage(material.configuration);
        const executor = createStageExecutor({ ...deps, settings: executionSettings(material.execution) });
        for (const c of await store.readStageCases(id)) {
          for (let trialIndex = 1; trialIndex <= 3; trialIndex++) {
            const { outcome, previouslySaved } = await runTrial({ store, executor, stage, experimentId: id, caseId: c.caseId, trialIndex, input: usefulnessInputSchema.parse(c.input), ownership: lock,
              assertOwnership: lock.assert });
            // A newly failed trial stops dispatch. Deliberate resume preserves
            // that terminal failure and continues to other intentional trials.
            if (outcome.state === "paused" || outcome.state !== "valid" && !previouslySaved) return inspect(id);
          }
        }
        return inspect(id);
      } finally { await lock(); }
    }
  };
}
