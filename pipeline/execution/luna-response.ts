import { z } from "zod";
import { PrivateError } from "../storage/crypto.js";

export const LUNA_GENERATION_URL = "https://openrouter.ai/api/v1/generation";
const routingSchema = z.object({ url: z.string(), status: z.number().int(), body: z.string() }).strict();
const legacyExchangeSchema = z.object({ schema: z.literal("wordwell-luna-exchange-v1"), completion: z.string(), routing: routingSchema.nullable() }).strict();
export const lunaExchangeSchema = z.union([legacyExchangeSchema,
  legacyExchangeSchema.extend({ schema: z.literal("wordwell-luna-exchange-v2"), routingLookups: z.array(routingSchema).max(6) }).strict(),
  legacyExchangeSchema.extend({ schema: z.literal("wordwell-luna-exchange-v3"), routingLookups: z.array(routingSchema).max(6),
    lookupAttempts: z.number().int().min(1).max(6), nextEligibleAt: z.iso.datetime().nullable() }).strict()]);
export const LUNA_LOOKUP_POLICY = { maxAttempts: 6, maxWaitMs: 30000, delaysMs: [1000, 2000, 4000, 8000, 8000] } as const;
export const LUNA_TRANSIENT_METADATA_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504, 524, 529]);
export async function lookupLunaRouting(options: { generationId: string; apiKey: string; fetch: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }) {
  const now = options.now ?? Date.now, deadline = now() + LUNA_LOOKUP_POLICY.maxWaitMs;
  const sleep = options.sleep ?? (ms => new Promise<void>(done => setTimeout(done, ms)));
  const lookups: z.infer<typeof routingSchema>[] = [];
  let nextEligibleAt: string | null = null;
  let attempts = 0;
  const url = `${LUNA_GENERATION_URL}?id=${encodeURIComponent(options.generationId)}`;
  for (let index = 0; index < LUNA_LOOKUP_POLICY.maxAttempts && now() < deadline; index++) {
    let providerDelay = 0;
    try {
      attempts++;
      const response = await options.fetch(url, { method: "GET", headers: { Authorization: `Bearer ${options.apiKey}` }, signal: AbortSignal.timeout(Math.max(1, deadline - now())) });
      const header = response.headers.get("retry-after");
      const parsed = header && /^\d+$/.test(header.trim()) ? Number(header.trim()) * 1000 : header ? Math.max(0, Date.parse(header) - now()) : 0;
      providerDelay = Number.isFinite(parsed) ? Math.min(parsed, 2_147_483_647) : 0;
      lookups.push({ url, status: response.status, body: await response.text() });
      if (!LUNA_TRANSIENT_METADATA_STATUSES.has(response.status)) break;
    } catch { /* Metadata transport failure may be retried; generation is already saved. */ }
    const delay = Math.max(LUNA_LOOKUP_POLICY.delaysMs[index] ?? 0, providerDelay);
    if (index + 1 === LUNA_LOOKUP_POLICY.maxAttempts || now() + delay >= deadline) {
      if (delay > 0) nextEligibleAt = new Date(now() + delay).toISOString();
      break;
    }
    await sleep(delay);
  }
  return { routing: lookups.at(-1) ?? null, lookups, attempts, nextEligibleAt };
}
export function completionBody(raw: string): string {
  const value = JSON.parse(raw);
  return ["wordwell-luna-exchange-v1", "wordwell-luna-exchange-v2", "wordwell-luna-exchange-v3"].includes(value?.schema) ? lunaExchangeSchema.parse(value).completion : raw;
}
export function checkLunaRouting(raw: string, expected: { requestedModel: string; pinnedModel: string }) {
  const exchange = lunaExchangeSchema.safeParse(JSON.parse(raw));
  if (!exchange.success || !exchange.data.routing || exchange.data.routing.status !== 200) throw new PrivateError("luna_routing_evidence_missing");
  const reply = z.object({ id: z.string().regex(/^gen-[0-9A-Za-z-]+$/), model: z.string(), provider: z.literal("OpenAI") }).passthrough().parse(JSON.parse(exchange.data.completion));
  const metadata = z.object({ data: z.object({ id: z.string(), model: z.literal(expected.pinnedModel), provider_name: z.literal("OpenAI"),
    response_cache_source_id: z.null(), provider_responses: z.array(z.object({ status: z.literal(200),
      provider_name: z.literal("OpenAI"), model_permaslug: z.literal(expected.pinnedModel) }).passthrough()).length(1) }).passthrough() }).passthrough().parse(JSON.parse(exchange.data.routing.body));
  if (reply.model !== expected.requestedModel && reply.model !== expected.pinnedModel || metadata.data.id !== reply.id ||
    exchange.data.routing.url !== `${LUNA_GENERATION_URL}?id=${encodeURIComponent(reply.id)}`) throw new PrivateError("luna_routing_evidence_mismatch");
  if (exchange.data.schema !== "wordwell-luna-exchange-v1" && (!exchange.data.routingLookups.length ||
    JSON.stringify(exchange.data.routingLookups.at(-1)) !== JSON.stringify(exchange.data.routing) ||
    exchange.data.routingLookups.some(r => r.url !== exchange.data.routing!.url))) throw new PrivateError("luna_lookup_history_mismatch");
  return { reply, metadata: metadata.data };
}
