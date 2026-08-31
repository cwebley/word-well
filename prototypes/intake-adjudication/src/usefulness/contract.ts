// The output contract for audience-usefulness adjudication.
//
// Its own fields, its own vocabulary, sharing nothing with morphology but the
// discipline: the model returns a finding, never a serving decision, and
// `deriveUsefulness` in policy.ts turns findings into advance / quarantine /
// exclude from the verdict alone.
//
// Version 2 makes two changes, both measured rather than guessed.
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

export const CONTRACT_VERSION = "usefulness-finding/2";

export const usefulnessValues = ["useful", "not_useful", "insufficient_evidence"] as const;

export const usefulnessFindingSchema = z.strictObject({
  sense_id: z
    .string()
    .describe("The sense_id of the meaning being judged, copied exactly."),
  usefulness: z
    .enum(usefulnessValues)
    .describe(
      "useful: an adult building a professional and academic vocabulary would be better off knowing this meaning. not_useful: they would not. insufficient_evidence: the supplied evidence is missing or incomplete, so the question cannot be settled.",
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
export type Usefulness = (typeof usefulnessValues)[number];

/** The strict JSON schema sent to the provider, derived from the zod schema. */
export const usefulnessJsonSchema = z.toJSONSchema(usefulnessFindingSchema, {
  target: "draft-2020-12",
});
