// The eval's three sides: what goes in, what comes back, and what we expected.
//
// `Expected` carries `label_status` deliberately. A five-case contract test runs
// against the author's reading of the evidence, not a human labelling pass, and
// a score computed against provisional labels must never be quoted as accuracy.

import { readFileSync } from "node:fs";
import { z } from "zod";

import { predictabilityValues, analysisSupportValues } from "../src/contract.ts";
import { dispositions } from "../src/policy.ts";

export const expectedLabelSchema = z.object({
  claim_id: z.string(),
  label_status: z.enum(["provisional-unvalidated", "human-validated"]),
  slice: z.string(),
  analysis_support: z.enum(analysisSupportValues),
  meanings: z.array(
    z.object({ sense_id: z.string(), predictability: z.enum(predictabilityValues) }),
  ),
  morphology_disposition: z.enum(dispositions),
  effective_disposition: z.enum(dispositions),
  endorsements: z.number(),
  note: z.string(),
});

export type ExpectedLabel = z.infer<typeof expectedLabelSchema>;

export function readLabels(path: string): Map<string, ExpectedLabel> {
  const labels = new Map<string, ExpectedLabel>();
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const label = expectedLabelSchema.parse(JSON.parse(line));
    labels.set(label.claim_id, label);
  }
  return labels;
}
