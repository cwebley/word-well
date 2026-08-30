// The output contract for audience-usefulness adjudication.
//
// Its own fields, its own vocabulary, sharing nothing with morphology but the
// discipline: the model returns a finding, never a serving decision, and
// `deriveUsefulness` in policy.ts turns findings into advance / quarantine /
// exclude from the verdict alone.
//
// One schema, two consumers: zod validates what came back, and z.toJSONSchema
// produces the strict JSON schema sent to the provider.
//
// strictObject, not object: a plain z.object silently strips fields it does not
// know about, which would quietly accept a model that returned a disposition of
// its own.

import { z } from "zod";

export const CONTRACT_VERSION = "usefulness-finding/1";

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
      "Identifiers from the supplied evidence that support this verdict. Every value must appear somewhere in the input.",
    ),
  diagnostic_confidence: z
    .number()
    .nullable()
    .describe(
      "Optional self-reported confidence from 0 to 1. Diagnostic only: it does not affect the outcome for this meaning.",
    ),
});

export type UsefulnessFinding = z.infer<typeof usefulnessFindingSchema>;
export type Usefulness = (typeof usefulnessValues)[number];

/** The strict JSON schema sent to the provider, derived from the zod schema. */
export const usefulnessJsonSchema = z.toJSONSchema(usefulnessFindingSchema, {
  target: "draft-2020-12",
});
