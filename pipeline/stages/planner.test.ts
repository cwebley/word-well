// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkPlan, createPlannerStage, PLANNER_CONFIGURATION, plannerPayload } from "./planner.js";
import { createLunaAdapter } from "../execution/openrouter.js";
import { scriptedFetch } from "../testing/private-fixtures.js";

import { plannerFixture, plannerPlan, plannerReply, plannerExchangeBody, plannerMetadataFetch, plannerRoutingMetadata } from "../testing/planner-fixtures.js";
import { completionBody } from "../execution/luna-response.js";
describe("source-backed planner", () => {
  it("renders opaque refs and optional evidence without private source identities or expectations", () => {
    const payload = plannerPayload(plannerFixture);
    expect(payload).toContain("s1 [noun] A thing used in a controlled check.");
    expect(payload).toContain("broader terms: example");
    expect(payload).not.toMatch(/private-source|private-entry|private-concept|expectation/);
    const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
    expect(stage.validate(plannerExchangeBody())).toEqual({ ok: true, result: plannerPlan });
  });
  it.each(["missing", "duplicate", "unknown", "wrong_pos", "unsupported_contrast", "duplicate_contrast", "unsupported_family", "too_many", "empty_definition", "unsupported_note"])("rejects %s without repair", kind => {
    const plan = structuredClone(plannerPlan);
    if (kind === "missing") plan.meanings[0].usage_note_sense_ids = [];
    if (kind === "duplicate") plan.meanings[0].sense_ids.push("s2");
    if (kind === "unknown") plan.meanings[0].sense_ids = ["s9"];
    if (kind === "wrong_pos") plan.meanings[0].part_of_speech = "verb";
    if (kind === "unsupported_contrast") plan.meanings[0].synonyms = ["invented"];
    if (kind === "duplicate_contrast") plan.meanings[0].synonyms.push("example");
    if (kind === "unsupported_family") plan.word_family = ["invented"];
    if (kind === "too_many") plan.word_family = Array(5).fill("fixtures");
    if (kind === "empty_definition") plan.meanings[0].definition = " ";
    if (kind === "unsupported_note") { plan.meanings = [{ ...plan.meanings[0], sense_ids: [], usage_note_sense_ids: ["s1", "s2"] }]; }
    expect(() => checkPlan(plannerFixture, plan)).toThrow();
  });
  it("allows justified complete omission as an inspectable no-meaning plan", () => {
    expect(checkPlan(plannerFixture, { meanings: [], word_family: [], omitted_source_meanings: [{ source_ref: "s1", reason: "Not useful in this lesson." }, { source_ref: "s2", reason: "Not useful in this lesson." }] }).meanings).toEqual([]);
  });
  it("rejects note-only contrasts and different-POS usage notes", () => {
    const input = structuredClone(plannerFixture);
    input.meanings[1].contrasts = input.meanings[0].contrasts;
    input.meanings[0].contrasts = [];
    expect(() => checkPlan(input, plannerPlan)).toThrow("planner_contrast_invalid");
    input.meanings[1].partOfSpeech = "verb";
    expect(() => checkPlan(input, plannerPlan)).toThrow("planner_pos_invalid");
  });
  it("forwards the exact recorded strict request through locked SDK/provider with one send", async () => {
    const remote = scriptedFetch([{ status: 200, body: plannerReply(), headers: { "content-type": "application/json" } }]);
    let metadataReads = 0;
    const adapter = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch, metadataFetch: async (...args) => { metadataReads++; return plannerMetadataFetch(...args); } });
    const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture), body = stage.render(plannerFixture);
    const exchange = await adapter.send(body, { timeoutMs: 10000 });
    expect(exchange.kind).toBe("response");
    if (exchange.kind === "response") expect(completionBody(exchange.body)).toBe(plannerReply());
    expect(metadataReads).toBe(0);
    expect(adapter.classify(exchange)).toEqual({ kind: "verification_pending" });
    expect(remote.sent).toHaveLength(1);
    expect(JSON.parse(remote.sent[0].body)).toEqual(body);
    expect(adapter.accounting(exchange)).toEqual({ generationId: "gen-harmless-planner", inputTokens: 900, outputTokens: 200, chargeNanoUsd: 420000 });
  });
  it.each([
    { status: 200, body: plannerReply({ incomplete: true }) },
    { status: 200, body: plannerReply(plannerPlan, { choices: [{ finish_reason: "length", message: { role: "assistant", content: "", refusal: null } }] }) },
    { status: 429, body: JSON.stringify({ error: { code: 429 }, usage: { cost: 0.0001 } }) },
    { status: 200, body: JSON.stringify({ error: { code: 503 }, usage: { cost: 0.0002 } }) }
  ])("retains raw charged errors despite SDK parse failures and never retries", async reply => {
    const remote = scriptedFetch([{ ...reply, headers: { "content-type": "application/json" } }]);
    const adapter = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch, metadataFetch: plannerMetadataFetch });
    const exchange = await adapter.send(createPlannerStage(PLANNER_CONFIGURATION, plannerFixture).render(plannerFixture), { timeoutMs: 10000 });
    expect(exchange).toMatchObject({ kind: "response", status: reply.status });
    if (exchange.kind === "response") expect(completionBody(exchange.body)).toBe(reply.body);
    expect(remote.sent).toHaveLength(1);
    expect(adapter.accounting(exchange).chargeNanoUsd).not.toBeNull();
  });
  it("accepts a canonical reply alias only with matching authenticated dated routing evidence", () => {
    const stage = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
    expect(stage.validate(plannerExchangeBody(plannerPlan, { model: "openai/gpt-5.6-luna" }))).toEqual({ ok: true, result: plannerPlan });
    expect(stage.validate(plannerReply(plannerPlan, { model: "openai/gpt-5.6-luna" })).ok).toBe(false);
    expect(stage.validate(plannerExchangeBody(plannerPlan, {}, { model: "openai/different-model" })).ok).toBe(false);
    expect(stage.validate(plannerExchangeBody(plannerPlan, {}, { id: "gen-unrelated" })).ok).toBe(false);
    expect(stage.validate(plannerExchangeBody(plannerPlan, {}, { response_cache_source_id: "gen-cached" })).ok).toBe(false);
    expect(stage.validate(plannerExchangeBody(plannerPlan, {}, { provider_responses: [{ status: 200, provider_name: "Azure", model_permaslug: "openai/gpt-5.6-luna-20260709" }] })).ok).toBe(false);
  });
  it("preserves a charged completion when routing lookup fails and refuses success", async () => {
    const remote = scriptedFetch([{ status: 200, body: plannerReply(), headers: { "content-type": "application/json" } }]);
    const adapter = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch, metadataSleep: async () => {}, metadataFetch: async () => { throw new Error("lookup-unavailable"); } });
    const exchange = await adapter.verify!(await adapter.send(createPlannerStage(PLANNER_CONFIGURATION, plannerFixture).render(plannerFixture), { timeoutMs: 10000 }));
    expect(adapter.accounting(exchange).chargeNanoUsd).toBe(420000);
    expect(adapter.classify(exchange)).toEqual({ kind: "verification_pending" });
    expect(remote.sent).toHaveLength(1);
  });
  it("waits for generation metadata after an initial 404 without another generation", async () => {
    const remote = scriptedFetch([{ status: 200, body: plannerReply(), headers: { "content-type": "application/json" } }]);
    let reads = 0;
    const adapter = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch,
      metadataFetch: async () => ++reads === 1 ? new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 }) : new Response(JSON.stringify(plannerRoutingMetadata())), metadataSleep: async () => {} });
    const exchange = await adapter.verify!(await adapter.send(createPlannerStage(PLANNER_CONFIGURATION, plannerFixture).render(plannerFixture), { timeoutMs: 10000 }));
    expect(adapter.classify(exchange)).toEqual({ kind: "reply" });
    expect(reads).toBe(2);
    expect(remote.sent).toHaveLength(1);
    if (exchange.kind === "response") expect(JSON.parse(exchange.body).routingLookups.map((r: { status: number }) => r.status)).toEqual([404, 200]);
  });
  it("bounds metadata reads and keeps the charge when the record never becomes available", async () => {
    const remote = scriptedFetch([{ status: 200, body: plannerReply(), headers: { "content-type": "application/json" } }]);
    let reads = 0;
    const adapter = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch, metadataSleep: async () => {}, metadataFetch: async () => {
      reads++; return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
    } });
    const exchange = await adapter.verify!(await adapter.send(createPlannerStage(PLANNER_CONFIGURATION, plannerFixture).render(plannerFixture), { timeoutMs: 10000 }));
    expect(reads).toBe(6);
    expect(remote.sent).toHaveLength(1);
    expect(adapter.accounting(exchange).chargeNanoUsd).toBe(420000);
    expect(adapter.classify(exchange)).toEqual({ kind: "verification_pending" });
  });
});
