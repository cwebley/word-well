// The output contract for morphology adjudication.
//
// The model returns findings, never a serving decision. `derive()` in policy.ts
// turns findings into advance / quarantine / exclude, and it is given only the
// fields it is allowed to see. Anything the model says about its own confidence
// is diagnostic and lives here purely so it can be logged and correlated later.
//
// One schema, two consumers: zod validates what came back, and z.toJSONSchema
// produces the strict JSON schema sent to the provider. Keeping them derived
// from the same object is what stops the prompt and the validator drifting.
//
// strictObject, not object: a plain z.object silently strips fields it does not
// know about, which would quietly accept a model that returned a disposition of
// its own. The provider-side schema forbids one; so must the validator.

import { z } from "zod";

export const CONTRACT_VERSION = "morphology-finding/1";

export const analysisSupportValues = [
  "supported",
  "unsupported",
  "insufficient_evidence",
] as const;

export const predictabilityValues = [
  "predictable",
  "not_predictable",
  "insufficient_evidence",
] as const;

export const meaningFindingSchema = z.strictObject({
  sense_ids: z
    .array(z.string())
    .describe(
      "Source-meaning identifiers this judgment covers, copied exactly from the candidate's source_meanings. Group only meanings that share a verdict for the same reason.",
    ),
  predictability: z
    .enum(predictabilityValues)
    .describe(
      "predictable: a learner who knows the claimed root or components could arrive at this meaning. not_predictable: the meaning carries something the parts do not give, including when the claimed parts are not the word's real formation. insufficient_evidence: missing or incomplete supplied evidence prevents a decision.",
    ),
  evidence_ids: z
    .array(z.string())
    .describe(
      "Identifiers from the supplied evidence that support this verdict. Every value must appear somewhere in the input.",
    ),
  rationale: z
    .string()
    .describe("One or two sentences recording the basis for this verdict, for human review."),
});

export const findingSchema = z.strictObject({
  claim_id: z
    .string()
    .describe("The claim_id of the claim being judged, copied exactly."),
  analysis_support: z
    .enum(analysisSupportValues)
    .describe(
      "Whether the supplied evidence supports the claimed decomposition as a real account of how this word is formed.",
    ),
  analysis_rationale: z
    .string()
    .describe("One or two sentences recording the basis for the analysis_support verdict."),
  analysis_evidence_ids: z
    .array(z.string())
    .describe("Identifiers from the supplied evidence that support the analysis_support verdict."),
  meanings: z
    .array(meaningFindingSchema)
    .describe(
      "One entry per group of candidate source meanings. Every candidate source meaning must appear in exactly one entry.",
    ),
  diagnostic_confidence: z
    .number()
    .nullable()
    .describe(
      "Optional self-reported confidence from 0 to 1. Diagnostic only: it does not affect the outcome for this claim.",
    ),
});

export type MeaningFinding = z.infer<typeof meaningFindingSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type AnalysisSupport = (typeof analysisSupportValues)[number];
export type Predictability = (typeof predictabilityValues)[number];

/** The strict JSON schema sent to the provider, derived from the zod schema. */
export const findingJsonSchema = z.toJSONSchema(findingSchema, {
  target: "draft-2020-12",
});
