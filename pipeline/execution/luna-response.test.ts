// @vitest-environment node
import { expect, it } from "vitest";
import { checkLunaRouting, completionBody } from "./luna-response.js";
import { plannerExchangeBody, plannerInlineBody, plannerPlan } from "../testing/planner-fixtures.js";
import { createPlannerStage, plannerConfigurationSchema, PLANNER_CONFIGURATION } from "../stages/planner.js";
import { createWriterStage, writerConfigurationSchema, WRITER_CONFIGURATION } from "../stages/writer.js";
import { plannerFixture } from "../testing/planner-fixtures.js";
import { writerFixture, writtenFixture } from "../testing/writer-fixtures.js";

const historical = { route: "openrouter-aisdk-v1", requestedModel: "openai/gpt-5.6-luna", pinnedModel: "openai/gpt-5.6-luna-20260709", provider: "openai",
  maxOutputTokens: 16000, prompt: "Historical synthetic prompt.", routingVerification: "authenticated-generation-resumable-v1",
  metadataRecovery: "saved-completion-append-only-rounds-v1", routingLookup: { maxAttempts: 6, maxWaitMs: 30000, delaysMs: [1000, 2000, 4000, 8000, 8000] } };

it.each(["wordwell-luna-exchange-v1", "wordwell-luna-exchange-v2", "wordwell-luna-exchange-v3"])("decodes retained historical evidence %s without network", schema => {
  const original = JSON.parse(plannerExchangeBody()), raw = JSON.stringify({ schema, completion: original.completion, routing: original.routing,
    ...(schema === "wordwell-luna-exchange-v1" ? {} : { routingLookups: original.routingLookups }),
    ...(schema === "wordwell-luna-exchange-v3" ? { lookupAttempts: 1, nextEligibleAt: null } : {}) });
  expect(completionBody(raw)).toBe(original.completion);
  expect(checkLunaRouting(raw, historical).metadata).toMatchObject({ model: historical.pinnedModel });
});

it("keeps historical stage validation under its original configurations", () => {
  const planner = createPlannerStage(plannerConfigurationSchema.parse({ ...historical, stage: "planner", schema: "wordwell-planner-configuration-v4" }), plannerFixture);
  const writer = createWriterStage(writerConfigurationSchema.parse({ ...historical, stage: "writer", schema: "wordwell-writer-configuration-v1" }), writerFixture);
  expect(planner.validate(plannerExchangeBody())).toEqual({ ok: true, result: plannerPlan });
  expect(writer.validate(plannerExchangeBody(writtenFixture))).toEqual({ ok: true, result: writtenFixture });
  expect(planner.validate(plannerExchangeBody(plannerPlan, {}, { response_cache_source_id: "gen-cached" })).ok).toBe(false);
  expect(writer.validate(plannerExchangeBody(writtenFixture, {}, { provider_responses: [] })).ok).toBe(false);
});

const attemptNumberPolicy = { ...historical, routingVerification: "completion-inline-attempt-number-v1" };

it("accepts documented first-attempt success without optional history only under the new policy", () => {
  const raw = plannerInlineBody(plannerPlan, {}, { attempts: undefined });
  expect(checkLunaRouting(raw, attemptNumberPolicy).metadata).toMatchObject({ attempt: 1 });
  expect(() => checkLunaRouting(raw, { ...historical, routingVerification: "completion-inline-strict-v1" })).toThrow("luna_verification_unresolved");
  expect(() => checkLunaRouting(raw, historical)).toThrow("luna_verification_unresolved");
});

it.each([
  ["missing attempt number", { attempt: undefined, attempts: undefined }, "luna_verification_unresolved"],
  ["string attempt number", { attempt: "1", attempts: undefined }, "luna_verification_unresolved"],
  ["later successful attempt", { attempt: 2, attempts: undefined }, "luna_routing_evidence_mismatch"],
  ["no provider attempt", { attempt: 0, attempts: undefined }, "luna_routing_evidence_mismatch"],
  ["null history", { attempts: null }, "luna_verification_unresolved"],
  ["object history", { attempts: { provider: "OpenAI" } }, "luna_verification_unresolved"],
  ["string history", { attempts: "not-a-list" }, "luna_verification_unresolved"],
  ["empty history", { attempts: [] }, "luna_verification_unresolved"],
  ["incomplete supplied history", { attempts: [{ provider: "OpenAI", model: historical.pinnedModel }] }, "luna_verification_unresolved"],
  ["undated supplied history", { attempts: [{ provider: "OpenAI", model: historical.requestedModel, status: 200 }] }, "luna_verification_unresolved"],
  ["failed supplied history", { attempts: [{ provider: "OpenAI", model: historical.pinnedModel, status: 503 }] }, "luna_routing_evidence_mismatch"],
  ["wrong supplied provider", { attempts: [{ provider: "Azure", model: historical.pinnedModel, status: 200 }] }, "luna_routing_evidence_mismatch"],
  ["multiple supplied attempts", { attempts: Array(2).fill({ provider: "OpenAI", model: historical.pinnedModel, status: 200 }) }, "luna_routing_evidence_mismatch"]
])("keeps incomplete or contradictory evidence from passing with optional history: %s", (_name, override, code) => {
  expect(() => checkLunaRouting(plannerInlineBody(plannerPlan, {}, override), attemptNumberPolicy)).toThrow(String(code));
});

it("versions both stages without changing their requests or the old inline interpretation", () => {
  const planner = createPlannerStage(PLANNER_CONFIGURATION, plannerFixture);
  const oldPlanner = createPlannerStage(plannerConfigurationSchema.parse({ ...PLANNER_CONFIGURATION, routingVerification: "completion-inline-strict-v1" }), plannerFixture);
  const writer = createWriterStage(WRITER_CONFIGURATION, writerFixture);
  const oldWriter = createWriterStage(writerConfigurationSchema.parse({ ...WRITER_CONFIGURATION, routingVerification: "completion-inline-strict-v1" }), writerFixture);
  expect(planner.render(plannerFixture)).toEqual(oldPlanner.render(plannerFixture));
  expect(writer.render(writerFixture)).toEqual(oldWriter.render(writerFixture));
  expect(planner.fingerprint).not.toBe(oldPlanner.fingerprint);
  expect(writer.fingerprint).not.toBe(oldWriter.fingerprint);
  expect(planner.validate(plannerInlineBody(plannerPlan, {}, { attempts: undefined }))).toEqual({ ok: true, result: plannerPlan });
  expect(writer.validate(plannerInlineBody(writtenFixture, {}, { attempts: undefined }))).toEqual({ ok: true, result: writtenFixture });
  expect(oldPlanner.validate(plannerInlineBody(plannerPlan, {}, { attempts: undefined }))).toEqual({ ok: false, code: "luna_verification_unresolved" });
  expect(oldWriter.validate(plannerInlineBody(writtenFixture, {}, { attempts: undefined }))).toEqual({ ok: false, code: "luna_verification_unresolved" });
});
