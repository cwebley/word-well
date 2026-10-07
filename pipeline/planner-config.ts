import { z } from "zod";
import type { ExecutionSettings } from "./execution/executor.js";

// Endpoint metadata and price ceilings verified without generation on 2026-10-07.
// The endpoint input limit includes model framing/schema tokens; this is not a
// characters-to-tokens estimate. Output allowance includes hidden reasoning.
export const lunaExecutionSchema = z.object({ schema: z.literal("wordwell-luna-execution-v1"),
  requestTimeoutMs: z.literal(600000), maxTransportRetries: z.literal(2), retryDelaysMs: z.tuple([z.literal(2000), z.literal(8000)]), maxRetryWaitMs: z.literal(60000),
  pricing: z.object({ status: z.literal("verified"), inputTokenBound: z.literal(922000), inputNanoUsdPerToken: z.literal(400),
    outputNanoUsdPerToken: z.literal(1800), requestFeeNanoUsd: z.literal(0), evidence: z.string().min(1) }).strict()
}).strict();
export const LUNA_EXECUTION = lunaExecutionSchema.parse({ schema: "wordwell-luna-execution-v1", requestTimeoutMs: 600000, maxTransportRetries: 2,
  retryDelaysMs: [2000, 8000], maxRetryWaitMs: 60000, pricing: { status: "verified", inputTokenBound: 922000, inputNanoUsdPerToken: 400,
    outputNanoUsdPerToken: 1800, requestFeeNanoUsd: 0, evidence: "2026-10-07: https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna-20260709/endpoints lists default OpenAI endpoint openai, pinned upstream openai/gpt-5.6-luna-20260709, max prompt 922000, max completion 128000, max_tokens/response_format/structured_outputs. Default prices $0.20/$1.20 per million, rising at 272000 prompt tokens to $0.40/$1.80. Provider only/order openai, no fallback, require_parameters and max_price enforce ceilings. https://openrouter.ai/docs/guides/best-practices/reasoning-tokens states max_tokens shares visible/reasoning budget; OpenAI max_completion_tokens documents inclusive output upper bound. No tools/plugins or request fee. SDK wire forwarding and raw accounting require controlled checks; live accounting remains to be observed under an approved cap." } });
export type LunaExecution = z.infer<typeof lunaExecutionSchema>;
export function lunaExecutionSettings(config: LunaExecution, maxOutputTokens: number): ExecutionSettings {
  const parsed = lunaExecutionSchema.parse(config);
  return { ...parsed, reservationNanoUsd: parsed.pricing.inputTokenBound * parsed.pricing.inputNanoUsdPerToken + maxOutputTokens * parsed.pricing.outputNanoUsdPerToken };
}
