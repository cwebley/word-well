// @vitest-environment node
import { expect, it } from "vitest";
import { createLunaAdapter } from "./openrouter.js";
import { createPlannerStage, PLANNER_CONFIGURATION } from "../stages/planner.js";
import { plannerFixture, plannerPlan, plannerReply } from "../testing/planner-fixtures.js";

const pinned = "openai/gpt-5.6-luna-20260709";
const metadata = { requested: pinned, attempt: 1, endpoints: { total: 1, available: [{ provider: "OpenAI", model: pinned, selected: true }] },
  attempts: [{ provider: "OpenAI", model: pinned, status: 200 }] };

it("verifies the original inline response and retains cache headers without a metadata request", async () => {
  const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  const completion = plannerReply(plannerPlan, { model: "openai/gpt-5.6-luna", openrouter_metadata: metadata });
  let sends = 0;
  let sentHeaders = new Headers();
  const model = createLunaAdapter({ apiKey: "synthetic", fetch: async (url, options) => {
    sends++;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    sentHeaders = new Headers(options?.headers);
    return new Response(completion, { headers: { "content-type": "application/json", "x-generation-id": "gen-harmless-planner", "x-openrouter-cache-status": "MISS" } });
  } });
  const response = await model.send(stage.render(plannerFixture), { timeoutMs: 1000 });
  expect(sends).toBe(1);
  expect(sentHeaders.get("x-openrouter-metadata")).toBe("enabled");
  expect(sentHeaders.get("x-openrouter-cache")).toBe("false");
  expect(model.verify).toBeUndefined();
  expect(model.classify(response)).toEqual({ kind: "reply" });
  expect(model.accounting(response)).toMatchObject({ generationId: "gen-harmless-planner", chargeNanoUsd: 420000 });
  if (response.kind !== "response") throw new Error("completion_missing");
  expect(JSON.parse(response.body)).toMatchObject({ schema: "wordwell-luna-exchange-v4", completion,
    headers: { cacheStatus: "MISS", generationId: "gen-harmless-planner" } });
  expect(stage.validate(response.body)).toMatchObject({ ok: true, result: plannerPlan });
});

it.each([
  ["absent metadata", undefined],
  ["missing attempt number", { ...metadata, attempt: undefined, attempts: undefined }],
  ["empty history", { ...metadata, attempts: [] }],
  ["undated attempt", { ...metadata, attempts: [{ provider: "OpenAI", model: "openai/gpt-5.6-luna", status: 200 }] }],
  ["undated selected endpoint", { ...metadata, endpoints: { available: [{ provider: "OpenAI", model: "openai/gpt-5.6-luna", selected: true }] } }],
  ["no selected endpoint", { ...metadata, endpoints: { available: [] } }],
  ["missing status", { ...metadata, attempts: [{ provider: "OpenAI", model: pinned }] }]
])("ends incomplete inline evidence as unresolved: %s", async (_name, evidence) => {
  const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  const model = createLunaAdapter({ apiKey: "synthetic", fetch: async () => new Response(plannerReply(plannerPlan, { openrouter_metadata: evidence })) });
  const response = await model.send(stage.render(plannerFixture), { timeoutMs: 1000 });
  expect(model.classify(response)).toEqual({ kind: "verification_unresolved", code: "luna_verification_unresolved" });
  expect(model.accounting(response).chargeNanoUsd).toBe(420000);
});

it.each([
  ["wrong completion model", { model: "openai/other-model", openrouter_metadata: undefined }, {}],
  ["wrong completion provider", { provider: "Azure", openrouter_metadata: undefined }, {}],
  ["wrong upstream model", { openrouter_metadata: { ...metadata, attempts: [{ provider: "OpenAI", model: "openai/gpt-5.6-luna-20260801", status: 200 }] } }, {}],
  ["wrong selected provider without history", { openrouter_metadata: { ...metadata, attempts: undefined, endpoints: { available: [{ provider: "Azure", model: pinned, selected: true }] } } }, {}],
  ["multiple attempts", { openrouter_metadata: { ...metadata, attempt: 2, attempts: [...metadata.attempts, ...metadata.attempts] } }, {}],
  ["failed upstream attempt", { openrouter_metadata: { ...metadata, attempts: [{ provider: "OpenAI", model: pinned, status: 503 }] } }, {}],
  ["cache hit without routing metadata", { openrouter_metadata: undefined }, { "x-openrouter-cache-status": "HIT" }],
  ["cache source despite MISS", {}, { "x-openrouter-cache-status": "MISS", "x-openrouter-cache-source-id": "gen-cached" }],
  ["cache age without HIT", {}, { "x-openrouter-cache-age": "12" }],
  ["mismatched generation header", {}, { "x-generation-id": "gen-unrelated" }]
] satisfies [string, Record<string, unknown>, Record<string, string>][])("rejects explicit contradictory evidence: %s", async (_name, override, headers) => {
  const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  const model = createLunaAdapter({ apiKey: "synthetic", fetch: async () => new Response(plannerReply(plannerPlan, override), { headers }) });
  const response = await model.send(stage.render(plannerFixture), { timeoutMs: 1000 });
  expect(model.classify(response)).toEqual({ kind: "rejected", code: "luna_routing_unverified" });
  expect(model.accounting(response).chargeNanoUsd).toBe(420000);
});

it("accepts additive routing fields and prompt-cache usage without treating them as response-cache reuse", async () => {
  const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  const model = createLunaAdapter({ apiKey: "synthetic", fetch: async () => new Response(plannerReply(plannerPlan, {
    model: "openai/gpt-5.6-luna", openrouter_metadata: { ...metadata, future: { opaque: true }, pipeline: [{ type: "future", data: {} }] },
    usage: { cost: 0.00042, prompt_tokens: 900, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 800 } }
  })) });
  const response = await model.send(stage.render(plannerFixture), { timeoutMs: 1000 });
  expect(model.classify(response)).toEqual({ kind: "reply" });
  expect(response.kind === "response" && stage.validate(response.body).ok).toBe(true);
});

it("accepts absent optional history without another request and retains the strict historical classifier", async () => {
  const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  let sends = 0;
  const model = createLunaAdapter({ apiKey: "synthetic", fetch: async () => {
    sends++;
    return new Response(plannerReply(plannerPlan, { openrouter_metadata: { ...metadata, attempts: undefined } }));
  } });
  const response = await model.send(stage.render(plannerFixture), { timeoutMs: 1000 });
  expect(model.classify(response)).toEqual({ kind: "reply" });
  expect(model.accounting(response).chargeNanoUsd).toBe(420000);
  const strict = createLunaAdapter({ routingVerification: "completion-inline-strict-v1", fetch: async () => { throw new Error("network_forbidden"); } });
  expect(strict.classify(response)).toEqual({ kind: "verification_unresolved", code: "luna_verification_unresolved" });
  expect(sends).toBe(1);
  expect(model.verify).toBeUndefined();
});

it.each([
  { id: null },
  { usage: { prompt_tokens: null, completion_tokens: 200, cost: 0.00042 } },
  { usage: { prompt_tokens: 900, completion_tokens: "unknown", cost: 0.00042 } }
])("retains each independently valid accounting field despite malformed evidence", async override => {
  const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  const model = createLunaAdapter({ apiKey: "synthetic", fetch: async () => new Response(plannerReply(plannerPlan, { ...override, openrouter_metadata: undefined })) });
  const response = await model.send(stage.render(plannerFixture), { timeoutMs: 1000 });
  expect(model.accounting(response).chargeNanoUsd).toBe(420000);
  expect(model.classify(response)).toEqual({ kind: "verification_unresolved", code: "luna_verification_unresolved" });
});

it.each(["length", "content_filter"])("decides routing before interpreting content failure %s", async finish_reason => {
  const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  for (const [override, classification] of [
    [{ openrouter_metadata: undefined }, { kind: "verification_unresolved", code: "luna_verification_unresolved" }],
    [{ provider: "Azure", openrouter_metadata: undefined }, { kind: "rejected", code: "luna_routing_unverified" }],
    [{}, { kind: "rejected", code: finish_reason === "length" ? "output_truncated" : "model_refusal" }]
  ] satisfies [Record<string, unknown>, Record<string, string>][]) {
    const model = createLunaAdapter({ apiKey: "synthetic", fetch: async () => new Response(plannerReply(plannerPlan, { ...override,
      choices: [{ index: 0, finish_reason, message: { role: "assistant", content: "", refusal: null } }] })) });
    const response = await model.send(stage.render(plannerFixture), { timeoutMs: 1000 });
    expect(model.classify(response)).toEqual(classification);
    expect(model.accounting(response).chargeNanoUsd).toBe(420000);
  }
});
