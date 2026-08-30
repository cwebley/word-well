// The eval's three sides: what goes in, what comes back, and what we expected.
//
// `Expected` carries `label_status` deliberately. A five-case contract test runs
// against the author's reading of the evidence, not a human labelling pass, and
// a score computed against provisional labels must never be quoted as accuracy.

import { z } from "zod";

import { readJsonl } from "../src/jsonl.ts";

import { predictabilityValues, analysisSupportValues } from "../src/contract.ts";
import { dispositions } from "../src/policy.ts";

export const expectedLabelSchema = z.object({
  claim_id: z.string(),
  label_status: z.enum(["provisional-unvalidated", "agent-reviewed", "human-validated"]),
  slice: z.string(),
  analysis_support: z.enum(analysisSupportValues),
  meanings: z.array(
    z.object({ sense_id: z.string(), predictability: z.enum(predictabilityValues) }),
  ),
  morphology_disposition: z.enum(dispositions),
  effective_disposition: z.enum(dispositions),
  endorsements: z.number(),
  note: z.string(),
  input_digest: z.string().optional(),
  rubric_version: z.string().optional(),
  partition: z.enum(["development", "regression", "hidden_holdout"]).optional(),
  review_decision: z.enum(["accepted", "corrected", "agent-reviewed"]).optional(),
  validated_at: z.string().optional(),
  endorsement_override: z.boolean().optional(),
});

export type ExpectedLabel = z.infer<typeof expectedLabelSchema>;

export function readLabels(path: string): Map<string, ExpectedLabel> {
  const labels = new Map<string, ExpectedLabel>();
  for (const label of readJsonl(path, expectedLabelSchema)) {
    if (labels.has(label.claim_id)) throw new Error(`${path} has duplicate label ${label.claim_id}`);
    labels.set(label.claim_id, label);
  }
  return labels;
}
