// The output contract for audience-usefulness adjudication.
//
// Its own fields, its own vocabulary, sharing nothing with morphology but the
// discipline: the model returns a finding, never a serving decision, and
// `deriveUsefulness` in policy.ts turns findings into advance / quarantine /
// exclude from the verdict alone.
//
// Version 3 records the graded exam category that the judge chose. Prompt 7
// listed several exam levels but collapsed all of them into `useful`, so the
// persisted finding could not show whether a word was judged middle-school,
// high-school, college or postgraduate vocabulary. Policy now derives the
// serving verdict from this field rather than asking the model for both.
//
// `evidence_ids` now cites the numbered labels from `evidenceItems`. Under
// version 1 the only identifier in a prompt was the sense id, so the field asked
// a question with one possible answer and the judge answered it by inventing
// names for real evidence. Numbering makes the citation checkable, and makes the
// field report which evidence actually carried the verdict.
//
// `diagnostic_confidence` is gone. It was the one field with no consumer:
// recorded, never read, structurally unable to reach a decision. Seventeen of
// nineteen values came back between 0.85 and 1.0, so it had no spread to
// correlate against either, and two came back as `3` on a scale documented as
// 0 to 1. Asking a model to rate itself buys nothing you can act on.
//
// One schema, two consumers: zod validates what came back, and z.toJSONSchema
// produces the strict JSON schema sent to the provider.
//
// strictObject, not object: a plain z.object silently strips fields it does not
// know about, which would quietly accept a model that returned a disposition of
// its own.

import { z } from "zod";

export const CONTRACT_VERSION = "usefulness-finding/3";

export const examLevelValues = [
  "ordinary",
  "middle_school",
  "high_school",
  "college",
  "postgraduate",
  "specialist_subject",
  "insufficient_evidence",
] as const;

export const usefulnessFindingSchema = z.strictObject({
  sense_id: z
    .string()
    .describe("The sense_id of the meaning being judged, copied exactly."),
  exam_level: z
    .enum(examLevelValues)
    .describe(
      "The earliest general vocabulary-exam level at which this word would plausibly be tested for the meaning shown. Use ordinary when it is too basic even for a middle-school vocabulary test; middle_school, high_school, college, or postgraduate for the earliest matching level; specialist_subject when it belongs on an exam inside one discipline rather than a general vocabulary exam; insufficient_evidence when missing or incomplete evidence prevents a decision.",
    ),
  rationale: z
    .string()
    .describe("One or two sentences recording the basis for this verdict, for human review."),
  evidence_ids: z
    .array(z.string())
    .describe(
      "The labels (E1, E2, …) of the evidence items this verdict actually rests on. Use only labels shown in the input.",
    ),
});

export type UsefulnessFinding = z.infer<typeof usefulnessFindingSchema>;
export type ExamLevel = (typeof examLevelValues)[number];

/** The strict JSON schema sent to the provider, derived from the zod schema. */
export const usefulnessJsonSchema = z.toJSONSchema(usefulnessFindingSchema, {
  target: "draft-2020-12",
});
