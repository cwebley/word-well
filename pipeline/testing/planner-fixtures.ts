import type { PlannerInput, LessonPlan } from "../stages/planner.js";
// Invented contract fixtures, never owner-approved evaluation cases.
export const plannerFixture: PlannerInput = { headword: "fixture", bundleId: "a".repeat(64), meanings: [
  { ref: "s1", sourceId: "private-source-1", entryId: "private-entry", conceptId: "private-concept-1", recordedPos: "n", partOfSpeech: "noun", order: 1,
    definition: "A thing used in a controlled check.", examples: ["The fixture made the check repeatable."], contrasts: [{ word: "example", type: "hypernym", support: { source: "oewn", from: "private-source-1", to: "linked-1", type: "hypernym" } }] },
  { ref: "s2", sourceId: "private-source-2", entryId: "private-entry", conceptId: "private-concept-2", recordedPos: "n", partOfSpeech: "noun", order: 2,
    definition: "An extension of the controlled check.", examples: [], contrasts: [] }
], family: [{ word: "fixtures", supports: [{ source: "kaikki", from: "line:1", to: "fixtures", type: "derived" }] }] };
export const plannerPlan: LessonPlan = { meanings: [{ definition: "A thing used in a check.", part_of_speech: "noun", sense_ids: ["s1"], usage_note_sense_ids: ["s2"], synonyms: ["example"] }], word_family: ["fixtures"], omitted_source_meanings: [] };
export function plannerInlineMetadata(override: Record<string, unknown> = {}) {
  return { requested: "openai/gpt-5.6-luna-20260709", attempt: 1,
    endpoints: { total: 1, available: [{ provider: "OpenAI", model: "openai/gpt-5.6-luna-20260709", selected: true }] },
    attempts: [{ provider: "OpenAI", model: "openai/gpt-5.6-luna-20260709", status: 200 }], ...override };
}
export function plannerReply(plan: unknown = plannerPlan, override: Record<string, unknown> = {}) {
  return JSON.stringify({ id: "gen-harmless-planner", model: "openai/gpt-5.6-luna-20260709", provider: "OpenAI", object: "chat.completion", created: 1,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(plan), refusal: null } }], usage: { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100, cost: 0.00042 }, openrouter_metadata: plannerInlineMetadata(), ...override });
}
export function plannerRoutingMetadata(id = "gen-harmless-planner", override: Record<string, unknown> = {}) {
  return { data: { id, model: "openai/gpt-5.6-luna-20260709", provider_name: "OpenAI", response_cache_source_id: null,
    provider_responses: [{ status: 200, provider_name: "OpenAI", model_permaslug: "openai/gpt-5.6-luna-20260709" }], ...override } };
}
export const plannerMetadataFetch: typeof globalThis.fetch = async url => {
  const request = new URL(String(url));
  if (request.pathname !== "/api/v1/generation") throw new Error("unexpected_metadata_request");
  return new Response(JSON.stringify(plannerRoutingMetadata(request.searchParams.get("id")!)), { headers: { "content-type": "application/json" } });
};
export function plannerExchangeBody(plan: unknown = plannerPlan, override: Record<string, unknown> = {}, metadataOverride: Record<string, unknown> = {}) {
  const completion = plannerReply(plan, override), id = JSON.parse(completion).id;
  const routing = { url: `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, status: 200, body: JSON.stringify(plannerRoutingMetadata(id, metadataOverride)) };
  return JSON.stringify({ schema: "wordwell-luna-exchange-v3", completion, routing, routingLookups: [routing], lookupAttempts: 1, nextEligibleAt: null });
}
export function plannerInlineBody(plan: unknown = plannerPlan, override: Record<string, unknown> = {}, metadataOverride: Record<string, unknown> = {}, headers: Record<string, string | null> = {}) {
  return JSON.stringify({ schema: "wordwell-luna-exchange-v4", completion: plannerReply(plan, { openrouter_metadata: plannerInlineMetadata(metadataOverride), ...override }),
    headers: { cacheStatus: null, cacheSourceId: null, cacheAge: null, cacheTtl: null, generationId: null, ...headers } });
}
