// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bundleSchema } from "./bundle.js";
import { plannerEvidence } from "./planner.js";
import { writerEvidence } from "./writer.js";
import { checkPlan, createPlannerStage, PLANNER_CONFIGURATION, type LessonPlan } from "../stages/planner.js";
import { checkWrittenLesson, createWriterStage, WRITER_CONFIGURATION } from "../stages/writer.js";
import { plannerInlineBody } from "../testing/planner-fixtures.js";

// Synthetic source records, never saved model answers or approved evaluation cases.
function bundleFixture() {
  return bundleSchema.parse({ scope: { controlled: true }, artifacts: [], entries: [
    { source: "oewn", id: "candidate-entry", headword: "evanescent", pos: "a", order: 1, role: "candidate", raw: "controlled-candidate", rawSha256: "a".repeat(64), locator: {}, data: {} },
    { source: "oewn", id: "brief-entry", headword: "brief", pos: "a", order: 2, role: "linked", raw: "controlled-brief", rawSha256: "b".repeat(64), locator: {}, data: { uncoveredMeaningIds: ["other-brief-meaning"] } },
    { source: "oewn", id: "short-entry", headword: "short-lived", pos: "a", order: 3, role: "linked", raw: "controlled-short", rawSha256: "c".repeat(64), locator: {}, data: {} }
  ], meanings: [
    { source: "oewn", entryId: "candidate-entry", id: "candidate-meaning", order: 1, conceptId: "candidate-concept", relations: [], data: { definition: "A fleeting controlled fixture.", examples: ["An evanescent fixture."] } },
    { source: "oewn", entryId: "brief-entry", id: "brief-meaning", order: 1, conceptId: "shared-concept", relations: [], data: { definition: "Lasting a short time.", examples: ["Linked example excluded from requests."] } },
    { source: "oewn", entryId: "short-entry", id: "short-meaning", order: 1, conceptId: "shared-concept", relations: [], data: { definition: "Lasting a short time.", examples: [] } }
  ], concepts: [], relations: [
    { source: "oewn", from: "candidate-meaning", to: "brief-meaning", word: "brief", type: "similar", purpose: "contrast" },
    { source: "oewn", from: "candidate-meaning", to: "short-meaning", word: "short-lived", type: "similar", purpose: "contrast" }
  ], frequency: { order: 1, form: "evanescent", tokens: ["evanescent"], storedFrequency: 1e-7, directZipf: 2 },
    supplemental: { page_id: "1", revision_id: "1", text_sha256: "a".repeat(64), raw_wikitext: "controlled", authenticatesKaikki: false, meanings: [] },
    diagnostics: [], coverage: { candidates: ["evanescent"], fullCorpus: false, oewnMeanings: 1, kaikkiMeanings: 6 }, modelCalls: 0 });
}
const bundleId = "d".repeat(64);
function planFixture(synonyms: string[]): LessonPlan {
  return { meanings: [{ definition: "A fleeting controlled fixture.", part_of_speech: "adjective", sense_ids: ["s1"], usage_note_sense_ids: [], synonyms }], word_family: [], omitted_source_meanings: [] };
}

describe("definition-backed planner selection", () => {
  it("projects the exact eligible linked definitions without importing other meanings or linked examples", () => {
    const bundle = bundleFixture(), input = plannerEvidence(bundleId, bundle);
    expect(input.meanings[0].contrasts).toEqual([
      { word: "brief", type: "similar", definition: "Lasting a short time.", support: { source: "oewn", from: "candidate-meaning", to: "brief-meaning", type: "similar" } },
      { word: "short-lived", type: "similar", definition: "Lasting a short time.", support: { source: "oewn", from: "candidate-meaning", to: "short-meaning", type: "similar" } }
    ]);
    const request = createPlannerStage(PLANNER_CONFIGURATION, input).render(input);
    expect(JSON.stringify(request)).toContain("brief: Lasting a short time.");
    expect(JSON.stringify(request)).toContain("short-lived: Lasting a short time.");
    expect(JSON.stringify(request)).not.toMatch(/candidate-meaning|brief-meaning|short-meaning|other-brief-meaning|Linked example/);
    expect(input.meanings[0].examples).toEqual(["An evanescent fixture."]);
    expect(bundle.entries[1].data.uncoveredMeaningIds).toEqual(["other-brief-meaning"]);
  });
  it.each(["missing_meaning", "missing_entry", "wrong_word", "wrong_source", "missing_definition", "blank_definition"])("stops on %s for any eligible contrast, including an unselected term", kind => {
    const bundle = bundleFixture();
    if (kind === "missing_meaning") bundle.meanings = bundle.meanings.filter(m => m.id !== "short-meaning");
    if (kind === "missing_entry") bundle.entries = bundle.entries.filter(e => e.id !== "short-entry");
    if (kind === "wrong_word") bundle.entries[2].headword = "another-word";
    if (kind === "wrong_source") bundle.meanings[2].source = "kaikki";
    if (kind === "missing_definition") delete bundle.meanings[2].data.definition;
    if (kind === "blank_definition") bundle.meanings[2].data.definition = " ";
    expect(() => plannerEvidence(bundleId, bundle)).toThrow("planner_contrast_evidence_missing");
  });
  it.each(["brief", "short-lived"])("passes a scripted planner selection of %s to the writer without adding the omitted candidate", term => {
    const bundle = bundleFixture(), input = plannerEvidence(bundleId, bundle), plan = planFixture([term]);
    const planner = createPlannerStage(PLANNER_CONFIGURATION, input);
    expect(planner.validate(plannerInlineBody(plan))).toEqual({ ok: true, result: plan });
    const writerInput = writerEvidence(bundleId, bundle, input, plan);
    expect(writerInput.meanings[0].synonyms).toEqual([term]);
    expect(writerInput.meanings[0].contrastDefinitions).toEqual([{ synonym: term, definitions: [{ sourceId: term === "brief" ? "brief-meaning" : "short-meaning", definition: "Lasting a short time." }] }]);
    const request = createWriterStage(WRITER_CONFIGURATION, writerInput).render(writerInput);
    const payload = JSON.stringify(request);
    expect(payload).toContain(`${term}: Lasting a short time.`);
    expect(payload).not.toContain(term === "brief" ? "short-lived" : "brief:");
    expect(payload).not.toContain("Linked example");
    expect(input.meanings[0].contrasts).toHaveLength(2);
  });
  it("leaves semantic selection to the prompt rather than rejecting identical definition strings", () => {
    const input = plannerEvidence(bundleId, bundleFixture()), plan = planFixture(["brief", "short-lived"]);
    expect(checkPlan(input, plan)).toEqual(plan);
    expect(createPlannerStage(PLANNER_CONFIGURATION, input).validate(plannerInlineBody(plan))).toEqual({ ok: true, result: plan });
  });
  it("allows a shared contrast side when the other side gives distinct guidance", () => {
    const bundle = bundleFixture(), input = plannerEvidence(bundleId, bundle), writerInput = writerEvidence(bundleId, bundle, input, planFixture(["brief", "short-lived"]));
    const lesson = { meanings: [{ meaning_id: "m1", examples: ["An evanescent fixture.", "Another evanescent fixture faded.", "The evanescent fixture disappeared."],
      situation: "Describing a fleeting fixture", not_for: "Describing a lasting fixture", common_patterns: ["an evanescent fixture"],
      synonyms: [{ synonym: "brief", more: "conciseness", less: "fading" }, { synonym: "short-lived", more: "limited lifespan", less: "fading" }], usage_notes: [], origin_note: null }] };
    // Shape and coverage checks do not judge these invented semantic labels.
    expect(checkWrittenLesson(writerInput, lesson)).toEqual(lesson);
  });
});
