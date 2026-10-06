import { z } from "zod";
import { pipelineConfigSchema } from "./config.js";
import { configurationSchema } from "./stages/appropriateness.js";
import { loadLocalConfig, type LocalConfig } from "../evals/private-appropriateness.js";
import type { ExecutionSettings } from "./execution/executor.js";

export const runMaterialSchema = z.object({
  schema: z.literal("wordwell-production-run-v1"),
  stage: z.literal("appropriateness"), mode: z.enum(["normal", "stage-only"]), fresh: z.boolean(),
  executionKind: z.enum(["live", "controlled"]),
  bundleId: z.string().regex(/^[a-f0-9]{64}$/), candidateId: z.uuid(), lessonId: z.string(), assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
  input: z.object({ headword: z.string().min(1).max(200) }).strict(),
  intake: pipelineConfigSchema, configuration: configurationSchema,
  execution: z.unknown().transform(loadLocalConfig),
  implementation: z.string().regex(/^[a-f0-9]{64}$/),
  reuseIdentity: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type RunMaterial = z.infer<typeof runMaterialSchema>;
export function executionSettings(config: LocalConfig): ExecutionSettings {
  const { execution, pricing } = loadLocalConfig(config);
  return { requestTimeoutMs: execution.requestTimeoutSeconds * 1000, maxTransportRetries: execution.maxTransportRetries,
    retryDelaysMs: execution.retryDelaysSeconds.map(s => s * 1000), maxRetryWaitMs: execution.maxRetryWaitSeconds * 1000,
    reservationNanoUsd: pricing.contextTokens * pricing.inputNanoUsdPerToken + pricing.requestFeeNanoUsd };
}
