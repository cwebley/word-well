import { z } from "zod";
import { fingerprint } from "../config.js";
import { PrivateError } from "../storage/crypto.js";
import { PLANNER_CONFIGURATION } from "../stages/planner.js";
import { LUNA_EXECUTION } from "../planner-config.js";

export const LUNA_METADATA_URL = "https://openrouter.ai/api/v1/models/openai/gpt-5.6-luna-20260709/endpoints";
const priceSchema = z.object({ prompt: z.string(), completion: z.string(), request: z.string().optional(), overrides: z.array(z.object({ prompt: z.string(), completion: z.string() }).passthrough()).optional() }).passthrough();
export async function verifyLunaSetup(fetch = globalThis.fetch) {
  const response = await fetch(LUNA_METADATA_URL, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new PrivateError("luna_metadata_unavailable");
  const raw = await response.text();
  const data = z.object({ data: z.object({ endpoints: z.array(z.object({ name: z.string(), tag: z.string(), status: z.number(), max_prompt_tokens: z.number().nullable(),
    max_completion_tokens: z.number().nullable(), pricing: priceSchema, supported_parameters: z.array(z.string()) }).passthrough()) }).passthrough() }).passthrough().parse(JSON.parse(raw));
  const endpoint = data.data.endpoints.find(e => e.tag === PLANNER_CONFIGURATION.provider);
  const prices = endpoint ? [endpoint.pricing, ...(endpoint.pricing.overrides ?? [])] : [];
  if (!endpoint || endpoint.status !== 0 || endpoint.name !== `OpenAI | ${PLANNER_CONFIGURATION.pinnedModel}` || endpoint.max_prompt_tokens !== LUNA_EXECUTION.pricing.inputTokenBound ||
    !endpoint.max_completion_tokens || endpoint.max_completion_tokens < PLANNER_CONFIGURATION.maxOutputTokens ||
    ["max_tokens", "response_format", "structured_outputs"].some(p => !endpoint.supported_parameters.includes(p)) ||
    Number(endpoint.pricing.request ?? "0") !== 0 || prices.some(p => !Number.isFinite(Number(p.prompt)) || !Number.isFinite(Number(p.completion)) ||
      Number(p.prompt) * 1e9 > LUNA_EXECUTION.pricing.inputNanoUsdPerToken || Number(p.completion) * 1e9 > LUNA_EXECUTION.pricing.outputNanoUsdPerToken)) throw new PrivateError("luna_endpoint_changed");
  return { endpoint, metadataIdentity: fingerprint(JSON.parse(raw)), raw, modelCalls: 0 };
}
