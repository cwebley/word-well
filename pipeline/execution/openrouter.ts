// AI SDK runs once. Raw HTTP capture occurs before SDK parsing, so structured
// output exceptions cannot discard a billable reply. Executor owns all retries.
import { generateObject, jsonSchema } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { PrivateError } from "../storage/crypto.js";
import type { Accounting, Classification, Exchange, ModelAdapter } from "./model.js";
import { checkLunaRouting, completionBody, lookupLunaRouting, lunaExchangeSchema, LUNA_TRANSIENT_METADATA_STATUSES } from "./luna-response.js";

export const LUNA_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const schema = z.record(z.string(), z.unknown());
export const lunaRequestSchema = z.object({ model: z.literal("openai/gpt-5.6-luna-20260709"), max_tokens: z.number().int().min(64).max(16000),
  messages: z.tuple([z.object({ role: z.literal("system"), content: z.tuple([z.object({ type: z.literal("text"), text: z.string() }).strict()]) }).strict(), z.object({ role: z.literal("user"), content: z.string() }).strict()]),
  response_format: z.object({ type: z.literal("json_schema"), json_schema: z.object({ name: z.literal("plan"), strict: z.literal(true), schema }).strict() }).strict(),
  provider: z.object({ only: z.tuple([z.literal("openai")]), order: z.tuple([z.literal("openai")]), allow_fallbacks: z.literal(false), require_parameters: z.literal(true),
    max_price: z.object({ prompt: z.literal(0.4), completion: z.literal(1.8), request: z.literal(0) }).strict() }).strict(), usage: z.object({ include: z.literal(true) }).strict()
}).strict();
const accountingSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(), usage: z.object({
  prompt_tokens: z.number().int().nonnegative().optional(), completion_tokens: z.number().int().nonnegative().optional(), cost: z.number().nonnegative().finite().optional()
}).passthrough().optional() }).passthrough();
const retryable = new Set([408, 429, 500, 502, 503, 504]);
function classifyStatus(status: number): Classification {
  return retryable.has(status) ? { kind: "retryable" } : { kind: "rejected", code: status === 401 || status === 403 ? "credentials_rejected" : status === 402 ? "insufficient_credits" : "provider_error" };
}
export function createLunaAdapter({ apiKey, fetch = globalThis.fetch, metadataFetch = fetch, metadataSleep }: { apiKey?: string; fetch?: typeof globalThis.fetch; metadataFetch?: typeof globalThis.fetch; metadataSleep?: (ms: number) => Promise<void> }): ModelAdapter {
  return { route: "openrouter-aisdk-v1",
    async send(value, { timeoutMs }): Promise<Exchange> {
      const body = lunaRequestSchema.parse(value);
      if (!apiKey) throw new PrivateError("dispatch_forbidden");
      let captured: Exchange | undefined, sends = 0;
      const capture: typeof globalThis.fetch = async (url, options) => {
        if (String(url) !== LUNA_ENDPOINT || sends !== 0 || !isDeepStrictEqual(JSON.parse(String(options?.body)), body)) throw new PrivateError("luna_sdk_request_mismatch");
        sends++;
        const response = await fetch(url, options);
        captured = { kind: "response", status: response.status, body: await response.clone().text(), retryAfter: response.headers.get("retry-after"), contentType: response.headers.get("content-type") };
        return response;
      };
      const provider = createOpenRouter({ apiKey, fetch: capture });
      try {
        await generateObject({ model: provider.chat(body.model, { provider: body.provider, usage: body.usage }),
          schema: jsonSchema(body.response_format.json_schema.schema), schemaName: body.response_format.json_schema.name,
          system: body.messages[0].content[0].text, prompt: body.messages[1].content, maxOutputTokens: body.max_tokens, maxRetries: 0,
          abortSignal: AbortSignal.timeout(timeoutMs), experimental_telemetry: { isEnabled: false } });
      } catch (error) {
        if (error instanceof PrivateError) throw error;
        if (!captured && sends === 0) throw new PrivateError("luna_sdk_incompatible");
        if (!captured) return { kind: "no_response", reason: (error as { name?: string }).name === "TimeoutError" ? "timeout" : "network" };
      }
      if (!captured) throw new PrivateError("luna_exchange_missing");
      return captured;
    },
    async verify(exchange) {
      if (exchange.kind !== "response") throw new PrivateError("luna_completion_missing");
      if (!apiKey) throw new PrivateError("metadata_credentials_required");
      const completion = completionBody(exchange.body);
      const id = z.object({ id: z.string().regex(/^gen-[0-9A-Za-z-]+$/) }).passthrough().parse(JSON.parse(completion)).id;
      const evidence = await lookupLunaRouting({ generationId: id, apiKey, fetch: metadataFetch, sleep: metadataSleep });
      return { ...exchange, body: JSON.stringify(lunaExchangeSchema.parse({ schema: "wordwell-luna-exchange-v3", completion,
        routing: evidence.routing, routingLookups: evidence.lookups, lookupAttempts: evidence.attempts, nextEligibleAt: evidence.nextEligibleAt })) };
    },
    accounting(exchange): Accounting {
      const empty: Accounting = { generationId: null, inputTokens: null, outputTokens: null, chargeNanoUsd: null };
      if (exchange.kind !== "response") return empty;
      try {
        const data = accountingSchema.parse(JSON.parse(completionBody(exchange.body)));
        const charge = data.usage?.cost === undefined ? null : Math.round(data.usage.cost * 1e9);
        return { generationId: data.id ?? null, inputTokens: data.usage?.prompt_tokens ?? null, outputTokens: data.usage?.completion_tokens ?? null,
          chargeNanoUsd: charge !== null && Number.isSafeInteger(charge) ? charge : null };
      } catch { return empty; }
    },
    classify(exchange): Classification {
      if (exchange.kind !== "response") return { kind: "uncertain" };
      if (exchange.status < 200 || exchange.status >= 300) return classifyStatus(exchange.status);
      try {
        const data = z.object({ error: z.object({ code: z.union([z.number(), z.string()]).optional() }).passthrough().optional(), choices: z.array(z.object({
          finish_reason: z.string(), message: z.object({ refusal: z.string().nullable().optional() }).passthrough() }).passthrough()).optional() }).passthrough().parse(JSON.parse(completionBody(exchange.body)));
        if (data.error) return classifyStatus(typeof data.error.code === "number" ? data.error.code : 400);
        if (data.choices?.some(c => c.finish_reason === "length")) return { kind: "rejected", code: "output_truncated" };
        if (data.choices?.some(c => c.message.refusal || c.finish_reason === "content_filter")) return { kind: "rejected", code: "model_refusal" };
      } catch { /* The stage retains and rejects malformed replies. */ }
      try {
        z.object({ id: z.string().regex(/^gen-[0-9A-Za-z-]+$/), model: z.enum(["openai/gpt-5.6-luna", "openai/gpt-5.6-luna-20260709"]), provider: z.literal("OpenAI") }).passthrough().parse(JSON.parse(completionBody(exchange.body)));
        const envelope = lunaExchangeSchema.safeParse(JSON.parse(exchange.body));
        if (!envelope.success || !envelope.data.routing || LUNA_TRANSIENT_METADATA_STATUSES.has(envelope.data.routing.status)) {
          return { kind: "verification_pending", ...(envelope.success && envelope.data.schema === "wordwell-luna-exchange-v3" && envelope.data.nextEligibleAt ? { nextEligibleAt: envelope.data.nextEligibleAt } : {}) };
        }
        checkLunaRouting(exchange.body, { requestedModel: "openai/gpt-5.6-luna", pinnedModel: "openai/gpt-5.6-luna-20260709" });
      }
      catch { return { kind: "rejected", code: "luna_routing_unverified" }; }
      return { kind: "reply" };
    }
  };
}
