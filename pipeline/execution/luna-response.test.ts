// @vitest-environment node
import { expect, it } from "vitest";
import { checkLunaRouting, completionBody } from "./luna-response.js";
import { plannerExchangeBody, plannerPlan } from "../testing/planner-fixtures.js";
import { createPlannerStage, plannerConfigurationSchema } from "../stages/planner.js";
import { createWriterStage, writerConfigurationSchema } from "../stages/writer.js";
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
