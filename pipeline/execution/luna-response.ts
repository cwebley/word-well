import { z } from "zod";
import { PrivateError } from "../storage/crypto.js";

export const LUNA_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const routingSchema = z.object({ url: z.string(), status: z.number().int(), body: z.string() }).strict();
const legacyExchangeSchema = z.object({ schema: z.literal("wordwell-luna-exchange-v1"), completion: z.string(), routing: routingSchema.nullable() }).strict();
export const lunaInlineExchangeSchema = z.object({ schema: z.literal("wordwell-luna-exchange-v4"), completion: z.string(), headers: z.object({
  cacheStatus: z.string().nullable(), cacheSourceId: z.string().nullable(), cacheAge: z.string().nullable(), cacheTtl: z.string().nullable(), generationId: z.string().nullable()
}).strict() }).strict();
export const lunaExchangeSchema = z.union([legacyExchangeSchema,
  legacyExchangeSchema.extend({ schema: z.literal("wordwell-luna-exchange-v2"), routingLookups: z.array(routingSchema).max(6) }).strict(),
  legacyExchangeSchema.extend({ schema: z.literal("wordwell-luna-exchange-v3"), routingLookups: z.array(routingSchema).max(6),
    lookupAttempts: z.number().int().min(1).max(6), nextEligibleAt: z.iso.datetime().nullable() }).strict(), lunaInlineExchangeSchema]);
export function completionBody(raw: string): string {
  const value = JSON.parse(raw);
  return ["wordwell-luna-exchange-v1", "wordwell-luna-exchange-v2", "wordwell-luna-exchange-v3", "wordwell-luna-exchange-v4"].includes(value?.schema) ? lunaExchangeSchema.parse(value).completion : raw;
}
const record = (value: unknown) => z.record(z.string(), z.unknown()).safeParse(value).data ?? {};
export function checkLunaInlineRouting(raw: string, expected: { requestedModel: string; pinnedModel: string }) {
  const unresolved = () => { throw new PrivateError("luna_verification_unresolved"); };
  const mismatch = () => { throw new PrivateError("luna_routing_evidence_mismatch"); };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return unresolved(); }
  const envelope = lunaInlineExchangeSchema.safeParse(value);
  if (!envelope.success) return unresolved();
  const { headers } = envelope.data;
  if (headers.cacheStatus?.trim().toUpperCase() === "HIT" || headers.cacheSourceId || headers.cacheAge !== null) return mismatch();
  let completion: unknown;
  try { completion = JSON.parse(envelope.data.completion); } catch { return unresolved(); }
  const reply = record(completion), metadata = record(reply.openrouter_metadata);
  const endpoints = record(metadata.endpoints);
  const selected = Array.isArray(endpoints.available) ? endpoints.available.map(record).filter(e => e.selected === true) : [];
  const attempts = Array.isArray(metadata.attempts) ? metadata.attempts.map(record) : [];
  // Inspect contradictions before checking completeness. Missing unrelated facts
  // cannot hide an explicit wrong route or cache hit.
  const wrongModel = (model: unknown) => typeof model === "string" && model !== expected.pinnedModel && model !== expected.requestedModel;
  if (wrongModel(reply.model) || typeof reply.provider === "string" && reply.provider !== "OpenAI" ||
    typeof metadata.attempt === "number" && metadata.attempt !== 1 || selected.length > 1 || attempts.length > 1 ||
    [...selected, ...attempts].some(e => wrongModel(e.model) || typeof e.provider === "string" && e.provider !== "OpenAI") ||
    attempts.some(e => typeof e.status === "number" && e.status !== 200) ||
    headers.generationId !== null && typeof reply.id === "string" && headers.generationId !== reply.id ||
    reply.response_cache_source_id !== undefined && reply.response_cache_source_id !== null) return mismatch();
  const proof = z.object({ id: z.string().regex(/^gen-[0-9A-Za-z-]+$/), model: z.enum([expected.requestedModel, expected.pinnedModel]), provider: z.literal("OpenAI"),
    openrouter_metadata: z.object({ attempt: z.literal(1), endpoints: z.object({ available: z.array(z.object({
      provider: z.string(), model: z.string(), selected: z.boolean() }).passthrough()) }).passthrough(),
      attempts: z.array(z.object({ provider: z.literal("OpenAI"), model: z.literal(expected.pinnedModel), status: z.literal(200) }).passthrough()).length(1)
    }).passthrough() }).passthrough().safeParse(completion);
  if (!proof.success || selected.length !== 1 || selected[0].provider !== "OpenAI" || selected[0].model !== expected.pinnedModel ||
    headers.cacheStatus !== null && headers.cacheStatus.trim().toUpperCase() !== "MISS") return unresolved();
  // OpenRouter documents that cache hits strip router metadata. A complete
  // current routing record proves no response-cache replay, even without MISS.
  return { reply: proof.data, metadata: proof.data.openrouter_metadata };
}
export function checkLunaRouting(raw: string, expected: { requestedModel: string; pinnedModel: string }) {
  const exchange = lunaExchangeSchema.safeParse(JSON.parse(raw));
  if (!exchange.success) throw new PrivateError("luna_routing_evidence_missing");
  const data = exchange.data;
  if (data.schema === "wordwell-luna-exchange-v4") return checkLunaInlineRouting(raw, expected);
  if (!data.routing || data.routing.status !== 200) throw new PrivateError("luna_routing_evidence_missing");
  const reply = z.object({ id: z.string().regex(/^gen-[0-9A-Za-z-]+$/), model: z.string(), provider: z.literal("OpenAI") }).passthrough().parse(JSON.parse(data.completion));
  const metadata = z.object({ data: z.object({ id: z.string(), model: z.literal(expected.pinnedModel), provider_name: z.literal("OpenAI"),
    response_cache_source_id: z.null(), provider_responses: z.array(z.object({ status: z.literal(200),
      provider_name: z.literal("OpenAI"), model_permaslug: z.literal(expected.pinnedModel) }).passthrough()).length(1) }).passthrough() }).passthrough().parse(JSON.parse(data.routing.body));
  if (reply.model !== expected.requestedModel && reply.model !== expected.pinnedModel || metadata.data.id !== reply.id ||
    data.routing.url !== `${LUNA_GENERATION_URL}?id=${encodeURIComponent(reply.id)}`) throw new PrivateError("luna_routing_evidence_mismatch");
  if (data.schema !== "wordwell-luna-exchange-v1" && (!data.routingLookups.length ||
    JSON.stringify(data.routingLookups.at(-1)) !== JSON.stringify(data.routing) ||
    data.routingLookups.some(r => r.url !== data.routing!.url))) throw new PrivateError("luna_lookup_history_mismatch");
  return { reply, metadata: metadata.data };
}
