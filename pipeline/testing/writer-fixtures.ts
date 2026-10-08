import type { WriterInput, WrittenLesson } from "../stages/writer.js";
import { plannerFixture, plannerPlan } from "./planner-fixtures.js";

// Synthetic controlled data, never approved live evaluation cases.
export const writerFixture: WriterInput = { headword: "fixture", bundleId: plannerFixture.bundleId, plannerInput: plannerFixture, plan: plannerPlan, excludedQuotations: [],
  meanings: [{ ref: "m1", definition: "A thing used in a check.", partOfSpeech: "noun", synonyms: ["example"],
    contrastDefinitions: [{ synonym: "example", definitions: [{ sourceId: "linked-1", definition: "A representative instance." }] }],
    examples: [{ source_ref: "s1", text: "The fixture made the check repeatable." }],
    usageNotes: [{ source_ref: "s2", definition: "An extension of the controlled check." }], origin: null, originAbsence: "Controlled absence." }] };
export const writtenFixture: WrittenLesson = { meanings: [{ meaning_id: "m1", examples: ["The fixture made the check repeatable.", "The town square became a fixture in her memories.", "They used a fixture to hold the part steady."],
  situation: "Describing a thing used to make a check repeatable", not_for: "Describing a spontaneous event", common_patterns: ["a test fixture"],
  synonyms: [{ synonym: "example", more: "illustration", less: "repeatability" }], usage_notes: [{ source_ref: "s2", text: "A fixture can extend a controlled check." }], origin_note: null }] };
