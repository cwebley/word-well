// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkWrittenLesson, createWriterStage, writerInputSchema, WRITER_CONFIGURATION } from "./writer.js";
import { writtenFixture, writerFixture } from "../testing/writer-fixtures.js";
import { plannerInlineBody as plannerExchangeBody } from "../testing/planner-fixtures.js";
import { assembleWrittenLesson } from "../sources/writer.js";
import { createLunaAdapter } from "../execution/openrouter.js";
import { scriptedFetch } from "../testing/private-fixtures.js";
import { plannerReply } from "../testing/planner-fixtures.js";

describe("writer contract", () => {
  it("requires the headword as a word in patterns rather than a substring of another word", () => {
    const written = structuredClone(writtenFixture);
    written.meanings[0].common_patterns = ["a fixtureless check"];
    expect(() => checkWrittenLesson(writerFixture, written)).toThrow("writer_patterns_invalid");
  });
  it("keeps definitions in the plan and preserves licensed example associations despite punctuation", () => {
    const written = structuredClone(writtenFixture);
    written.meanings[0].examples[0] = "The fixture made the check repeatable!";
    written.meanings[0].synonyms[0] = { synonym: "example", more: null, less: null };
    const assembled = assembleWrittenLesson(writerFixture, checkWrittenLesson(writerFixture, written));
    expect(assembled.meanings[0]).toMatchObject({ definition: "A thing used in a check.", part_of_speech: "noun", originSupport: null,
      exampleAssociations: [{ index: 0, directMatches: ["s1"], adaptationReviewRequired: true }, { index: 1, directMatches: [], adaptationReviewRequired: true }, { index: 2, directMatches: [], adaptationReviewRequired: true }] });
    expect(assembled.meanings[0].synonyms[0]).toEqual({ synonym: "example", more: null, less: null });
  });
  it.each(["missing", "duplicate", "unknown"])("rejects %s meaning output without repairing it", kind => {
    const written = structuredClone(writtenFixture);
    if (kind === "missing") written.meanings = [];
    if (kind === "duplicate") written.meanings.push(structuredClone(written.meanings[0]));
    if (kind === "unknown") written.meanings[0].meaning_id = "m2";
    expect(() => checkWrittenLesson(writerFixture, written)).toThrow("writer_meaning_coverage_invalid");
  });
  it.each(["missing", "duplicate", "unknown"])("requires exact %s usage-note accounting", kind => {
    const written = structuredClone(writtenFixture);
    if (kind === "missing") written.meanings[0].usage_notes = [];
    if (kind === "duplicate") written.meanings[0].usage_notes.push(structuredClone(written.meanings[0].usage_notes[0]));
    if (kind === "unknown") written.meanings[0].usage_notes[0].source_ref = "s1";
    expect(() => checkWrittenLesson(writerFixture, written)).toThrow("writer_usage_notes_invalid");
  });
  it("rejects invented contrasts, blank teaching fields, writer definitions and unsupported origins", () => {
    const contrast = structuredClone(writtenFixture); contrast.meanings[0].synonyms[0].synonym = "invented";
    expect(() => checkWrittenLesson(writerFixture, contrast)).toThrow("writer_contrast_invalid");
    const empty = structuredClone(writtenFixture); empty.meanings[0].examples[1] = " ";
    expect(() => checkWrittenLesson(writerFixture, empty)).toThrow("writer_teaching_fields_invalid");
    const replacement = { meanings: [{ ...writtenFixture.meanings[0], definition: "A writer replacement." }] };
    expect(() => checkWrittenLesson(writerFixture, replacement)).toThrow("writer_schema_invalid");
    const origin = structuredClone(writtenFixture); origin.meanings[0].origin_note = "An invented origin.";
    expect(() => checkWrittenLesson(writerFixture, origin)).toThrow("writer_origin_invalid");
    const changed = structuredClone(writerFixture); changed.meanings[0].definition = "A changed plan.";
    expect(writerInputSchema.safeParse(changed).success).toBe(false);
  });
  it("does not invent a deterministic metaphor test and accepts nullable contrast sides", () => {
    const written = structuredClone(writtenFixture);
    written.meanings[0].synonyms[0].less = null;
    expect(checkWrittenLesson(writerFixture, written)).toEqual(written);
  });
  it("renders only planned content and requires saved exact routing proof", () => {
    const stage = createWriterStage(WRITER_CONFIGURATION, writerFixture), request = stage.render(writerFixture);
    expect(JSON.stringify(request)).not.toContain("private-source-1");
    expect(JSON.stringify(request)).not.toContain("private-concept-1");
    expect(request).toMatchObject({ provider: { only: ["openai"], allow_fallbacks: false }, response_format: { json_schema: { strict: true } } });
    expect(stage.validate(plannerExchangeBody(writtenFixture))).toEqual({ ok: true, result: writtenFixture });
    expect(stage.validate(plannerExchangeBody(writtenFixture, {}, {}, { cacheSourceId: "gen-cached" }))).toMatchObject({ ok: false });
    expect(stage.validate(plannerReply(writtenFixture))).toMatchObject({ ok: false });
  });
  it("forwards the writer schema through the verified SDK and retains charged malformed output", async () => {
    const stage = createWriterStage(WRITER_CONFIGURATION, writerFixture), remote = scriptedFetch([{ status: 200, body: plannerReply({ invalid: true }), headers: { "content-type": "application/json" } }]);
    const model = createLunaAdapter({ apiKey: "harmless-key", fetch: remote.fetch });
    const exchange = await model.send(stage.render(writerFixture), { timeoutMs: 600000 });
    expect(remote.sent).toHaveLength(1);
    expect(JSON.parse(remote.sent[0].body)).toEqual(stage.render(writerFixture));
    expect(model.accounting(exchange)).toMatchObject({ chargeNanoUsd: 420000 });
    expect(exchange.kind === "response" && stage.validate(exchange.body)).toMatchObject({ ok: false });
  });
  it("rejects a retained external quotation in writer output without exposing the exclusion to the model", () => {
    const input = { ...writerFixture, excludedQuotations: [{ source_ref: "line:1:meaning:1", text: "This fixture is an excluded quotation." }] };
    const written = structuredClone(writtenFixture); written.meanings[0].examples[1] = "This fixture is an excluded quotation!";
    expect(() => checkWrittenLesson(input, written)).toThrow("writer_external_quotation");
    const stage = createWriterStage(WRITER_CONFIGURATION, input);
    expect(JSON.stringify(stage.render(input))).not.toContain("line:1:meaning:1");
    expect(JSON.stringify(stage.render(input))).not.toContain("excluded quotation");
  });
  it("supplies pinned definitions only for selected contrasts while keeping source identities private", () => {
    const input = { ...writerFixture, meanings: [{ ...writerFixture.meanings[0], contrastDefinitions: [
      { synonym: "example", definitions: [{ sourceId: "linked-1", definition: "A representative instance." }] }
    ] }] };
    const request = createWriterStage(WRITER_CONFIGURATION, input).render(input);
    expect(JSON.stringify(request)).toContain("example: A representative instance.");
    expect(JSON.stringify(request)).not.toContain("linked-1");
  });
  it("rejects missing, duplicate or unsupported selected-contrast definition support", () => {
    const missing = structuredClone(writerFixture); missing.meanings[0].contrastDefinitions = [];
    expect(writerInputSchema.safeParse(missing).success).toBe(false);
    const duplicate = structuredClone(writerFixture); duplicate.meanings[0].contrastDefinitions!.push(structuredClone(duplicate.meanings[0].contrastDefinitions![0]));
    expect(writerInputSchema.safeParse(duplicate).success).toBe(false);
    const unknown = structuredClone(writerFixture); unknown.meanings[0].contrastDefinitions![0].definitions[0].sourceId = "unselected-source";
    expect(writerInputSchema.safeParse(unknown).success).toBe(false);
  });
  it("preserves the historical names-only request and requires definition evidence in the new mode", () => {
    const legacy = structuredClone(writerFixture); delete legacy.meanings[0].contrastDefinitions;
    const { contrastEvidence, ...historicalConfig } = WRITER_CONFIGURATION;
    expect(contrastEvidence).toBe("selected-definitions-v1");
    const stage = createWriterStage(historicalConfig, legacy);
    expect(stage.render(legacy)).toMatchObject({ messages: [{ role: "system" }, { role: "user", content:
      "headword: fixture\n\nm1 [noun] A thing used in a check.\n    synonyms: example\n    source examples: s1: The fixture made the check repeatable.\n    usage-note senses: s2: An extension of the controlled check.\n    origin: none" }] });
    expect(stage.validate(plannerExchangeBody(writtenFixture))).toEqual({ ok: true, result: writtenFixture });
    expect(() => createWriterStage(WRITER_CONFIGURATION, legacy)).toThrow("writer_contrast_evidence_missing");
  });
});
