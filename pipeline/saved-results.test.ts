// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateSavedPlannerResult, validateSavedWriterResult } from "./saved-results.js";
import { createPlannerStage, PLANNER_CONFIGURATION } from "./stages/planner.js";
import { createWriterStage, WRITER_CONFIGURATION } from "./stages/writer.js";
import { plannerFixture, plannerPlan, plannerInlineBody } from "./testing/planner-fixtures.js";
import { writerFixture, writtenFixture } from "./testing/writer-fixtures.js";
import { assembleWrittenLesson } from "./sources/writer.js";
import { plannerReuseIdentity } from "./planner-identity.js";
import { writerReuseIdentity } from "./writer-identity.js";
import { loadPipelineConfig } from "./config.js";
import { LUNA_EXECUTION } from "./planner-config.js";
import type { AttemptRecord } from "./storage/postgres.js";

async function fixture(kind: "planner" | "writer") {
  const input = kind === "planner" ? plannerFixture : writerFixture;
  const configuration = kind === "planner" ? PLANNER_CONFIGURATION : WRITER_CONFIGURATION;
  const stage = kind === "planner" ? createPlannerStage(PLANNER_CONFIGURATION, plannerFixture) : createWriterStage(WRITER_CONFIGURATION, writerFixture);
  const output = kind === "planner" ? plannerPlan : writtenFixture;
  const runId = randomUUID(), attemptId = randomUUID(), candidateId = randomUUID();
  const originalDependencies = { assessmentId: "a".repeat(64), appropriatenessResultId: randomUUID(), usefulnessResultId: randomUUID(),
    ...(kind === "writer" ? { plannerResultId: randomUUID() } : {}) };
  const reuseIdentity = kind === "planner" ? await plannerReuseIdentity(plannerFixture, PLANNER_CONFIGURATION) : await writerReuseIdentity(writerFixture, WRITER_CONFIGURATION);
  const run = { id: runId, candidateId, status: "accepted", material: { schema: `wordwell-${kind}-run-v1`, stage: kind, mode: "normal", fresh: false,
    executionKind: "controlled", candidateId, bundleId: input.bundleId, input, configuration, intake: await loadPipelineConfig("config/pipeline.yaml"),
    execution: LUNA_EXECUTION, implementation: "fixture-implementation", reuseIdentity, originalDependencies } };
  const selected = { id: randomUUID(), runId, reuseIdentity, material: { schema: `wordwell-production-${kind}-v1`, executionKind: "controlled", input,
    configurationFingerprint: stage.fingerprint, attemptId, originalDependencies,
    ...(kind === "planner" ? { plan: output } : { written: output, assembled: assembleWrittenLesson(writerFixture, writtenFixture) }) } };
  const attempt: AttemptRecord = { id: attemptId, runId, experimentId: null, stage: kind, status: "valid", outcomeCode: null, nextEligibleAt: null,
    input: { input, request: stage.render(input as never), provenance: originalDependencies }, result: output,
    requests: [{ id: randomUUID(), sequence: 1, status: "responded", reservedNanoUsd: 1, chargeStatus: "known", chargeNanoUsd: 1,
      httpStatus: 200, retryable: false, retryAfterMs: null, generationId: null, inputTokens: null, outputTokens: null,
      createdAt: new Date(0), completedAt: new Date(0), response: { kind: "response", status: 200, body: plannerInlineBody(output), retryAfter: null, contentType: "application/json" } }] };
  return { selected, run, attempt, expectedInput: input, configuration, executionKind: "controlled" as const, candidateId };
}

for (const kind of ["planner", "writer"] as const) {
  const validate = (value: Awaited<ReturnType<typeof fixture>>) => kind === "planner"
    ? validateSavedPlannerResult({ ...value, expectedInput: plannerFixture, configuration: PLANNER_CONFIGURATION })
    : validateSavedWriterResult({ ...value, expectedInput: writerFixture, configuration: WRITER_CONFIGURATION });
  describe(`${kind} saved evidence`, () => {
    it("revalidates raw evidence without a store or model adapter", async () => {
      const value = await fixture(kind);
      expect(await validate(value)).toMatchObject({ originalDependencies: value.run.material.originalDependencies });
    });
    const corruptions: [string, (value: Awaited<ReturnType<typeof fixture>>) => void][] = [
      ["missing original run", v => { v.run = null as never; }],
      ["wrong run identity", v => { v.run.id = randomUUID(); }],
      ["wrong run candidate", v => { v.run.candidateId = randomUUID(); }],
      ["wrong payload candidate", v => { v.run.material.candidateId = randomUUID(); }],
      ["unfinished original run", v => { v.run.status = "paused"; }],
      ["rejected original run with nonempty output", v => { v.run.status = "rejected"; }],
      ["changed original configuration", v => { v.run.material.configuration = { ...v.run.material.configuration, maxOutputTokens: 1234 }; }],
      ["changed original provenance", v => { v.run.material.originalDependencies = { ...v.run.material.originalDependencies, usefulnessResultId: randomUUID() }; }],
      ["changed saved input", v => { v.run.material.input = { ...v.run.material.input, headword: "other" }; }],
      ["changed bundle", v => { v.run.material.bundleId = "b".repeat(64); }],
      ["changed run reuse identity", v => { v.run.material.reuseIdentity = "b".repeat(64); }],
      ["changed selected reuse identity", v => { v.selected.reuseIdentity = "b".repeat(64); }],
      ["changed execution kind", v => { v.run.material.executionKind = "live"; }],
      ["missing attempt", v => { v.attempt = null as never; }],
      ["wrong attempt identity", v => { v.attempt.id = randomUUID(); }],
      ["wrong attempt run", v => { v.attempt.runId = randomUUID(); }],
      ["wrong attempt stage", v => { v.attempt.stage = "usefulness"; }],
      ["changed result configuration fingerprint", v => { v.selected.material.configurationFingerprint = "b".repeat(64); }],
      ["changed result input", v => { v.selected.material.input = { ...v.expectedInput, headword: "other" }; }],
      ["changed result provenance", v => { v.selected.material.originalDependencies = { ...v.selected.material.originalDependencies, appropriatenessResultId: randomUUID() }; }],
      ["changed attempt input", v => { v.attempt.input.input = { ...v.expectedInput, headword: "other" }; }],
      ["changed attempt provenance", v => { v.attempt.input.provenance = {}; }],
      ["changed rendered request", v => { v.attempt.input.request = {}; }],
      ["invalid attempt", v => { v.attempt.status = "invalid"; }],
      ["missing raw response", v => { v.attempt.requests = []; }],
      ["changed interpreted result", v => { v.attempt.result = {}; }],
      ["changed raw response", v => { v.attempt.requests[0].response = { kind: "response", status: 200, body: plannerInlineBody({ invalid: true }), retryAfter: null, contentType: "application/json" }; }]
    ];
    it.each(corruptions)("rejects %s", async (_name, corrupt) => {
      const value = await fixture(kind);
      corrupt(value);
      await expect(validate(value)).rejects.toThrow(`${kind}_result_not_valid`);
    });
    if (kind === "planner") it("reuses rejected empty plans but rejects an accepted run with empty output", async () => {
      const value = await fixture(kind);
      const empty = { meanings: [], word_family: [], omitted_source_meanings: plannerFixture.meanings.map(m => ({ source_ref: m.ref, reason: "Controlled omission." })) };
      value.run.status = "rejected";
      value.selected.material = { ...value.selected.material, plan: empty } as never;
      value.attempt.result = empty;
      value.attempt.requests[0].response = { kind: "response", status: 200, body: plannerInlineBody(empty), retryAfter: null, contentType: "application/json" };
      expect(await validate(value)).toMatchObject({ plan: empty });
      value.run.status = "accepted";
      await expect(validate(value)).rejects.toThrow("planner_result_not_valid");
    });
    if (kind === "writer") it("rejects an assembly that differs from the saved writer output", async () => {
      const value = await fixture(kind);
      value.selected.material = { ...value.selected.material, assembled: {} as never };
      await expect(validate(value)).rejects.toThrow("writer_result_not_valid");
    });
    it("uses the latest saved verification instead of an older acceptable reply", async () => {
      const value = await fixture(kind);
      value.attempt.requests[0].verifications = [{ id: randomUUID(), response: { kind: "no_response", reason: "network" } }];
      await expect(validate(value)).rejects.toThrow(`${kind}_result_not_valid`);
    });
  });
}
