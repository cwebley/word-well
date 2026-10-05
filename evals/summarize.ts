// Strict aggregate-only summary of a finalized private experiment (#8). This
// is the only thing that may leave the machine. Fixed named fields: bounded
// numbers, booleans, fixed literals, constrained opaque IDs and digests. No
// case IDs, words, reasons, replies, errors, paths or free text.
import { z } from "zod";
import { createHash } from "node:crypto";
import type { ExperimentSummary } from "./scorers/appropriateness.js";

const TRIALS = 3;
const count = z.number().int().min(0).max(1_000_000);
const rate = z.object({ numerator: count, denominator: count, value: z.number().min(0).max(1).nullable() }).strict()
  .refine(r => r.numerator <= r.denominator && (r.denominator === 0 ? r.value === null : r.value === r.numerator / r.denominator));
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

export const summarySchema = z.object({
  schema: z.literal("wordwell-appropriateness-summary-v1"),
  experimentId: z.uuid(),
  datasetId: z.uuid(),
  datasetVersion: z.number().int().min(1).max(999_999),
  configurationFingerprint: sha256,
  pinnedModel: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]{1,80}$/),
  purpose: z.enum(["evaluation", "smoke", "audit"]),
  // The pass rule the counts were scored under.
  passRule: z.literal("no-wrong-accepts"),
  split: z.enum(["all", "development", "held-out"]),
  counts: z.object({
    cases: count, requiredTrials: count, validTrials: count, invalidTrials: count, failedTrials: count,
    unresolvedTrials: count, missingTrials: count, trialWrongAccepts: count, trialWrongRejects: count,
    averagedWrongAccepts: count, averagedWrongRejects: count, casesAllThreeCorrect: count, unstableCases: count, passedCases: count
  }).strict(),
  goldenRequirementsPass: z.boolean(),
  rates: z.object({ trialsCorrect: rate, casesPassed: rate, casesAllThreeCorrect: rate, unstableCases: rate }).strict(),
  cost: z.object({ knownUsd: z.number().min(0).max(1_000_000), unresolvedRequests: count, physicalRequests: count }).strict(),
  timing: z.object({ startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), durationSeconds: z.number().min(0).max(10_000_000) }).strict()
}).strict().superRefine((s, ctx) => {
  const c = s.counts;
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (c.requiredTrials !== c.cases * TRIALS) fail("required_trials");
  if (c.validTrials + c.invalidTrials + c.failedTrials + c.unresolvedTrials + c.missingTrials !== c.requiredTrials) fail("trial_denominator");
  if (c.trialWrongAccepts + c.trialWrongRejects > c.validTrials) fail("trial_errors");
  // Passing tolerates wrong rejects, so it can exceed all-three-correct.
  if (c.passedCases > c.cases || c.casesAllThreeCorrect > c.passedCases || c.unstableCases > c.cases) fail("case_counts");
  // An empty or incomplete set can never pass.
  if (s.goldenRequirementsPass && (c.cases === 0 || c.passedCases !== c.cases)) fail("pass_inconsistent");
});
export type Summary = z.infer<typeof summarySchema>;

export const parseSummary = (value: unknown): Summary => summarySchema.parse(value);
// Canonical: the parsed object has schema-defined key order.
export const summaryDigest = (summary: Summary): string =>
  createHash("sha256").update(JSON.stringify(summarySchema.parse(summary))).digest("hex");

const ratio = (numerator: number, denominator: number) => ({ numerator, denominator, value: denominator === 0 ? null : numerator / denominator });

export function buildSummary(input: {
  experimentId: string; datasetId: string; datasetVersion: number; configurationFingerprint: string; pinnedModel: string;
  purpose: "evaluation" | "smoke" | "audit"; split: "all" | "development" | "held-out"; summary: ExperimentSummary;
  spend: { knownNanoUsd: number; unresolvedRequests: number; physicalRequests: number };
  startedAt: Date; finishedAt: Date;
}): Summary {
  const { goldenRequirementsPass, ...counts } = input.summary;
  return parseSummary({
    schema: "wordwell-appropriateness-summary-v1",
    experimentId: input.experimentId, datasetId: input.datasetId, datasetVersion: input.datasetVersion,
    configurationFingerprint: input.configurationFingerprint, pinnedModel: input.pinnedModel, purpose: input.purpose, passRule: "no-wrong-accepts", split: input.split,
    counts, goldenRequirementsPass,
    rates: {
      trialsCorrect: ratio(counts.validTrials - counts.trialWrongAccepts - counts.trialWrongRejects, counts.requiredTrials),
      casesPassed: ratio(counts.passedCases, counts.cases),
      casesAllThreeCorrect: ratio(counts.casesAllThreeCorrect, counts.cases),
      unstableCases: ratio(counts.unstableCases, counts.cases)
    },
    cost: { knownUsd: input.spend.knownNanoUsd / 1e9, unresolvedRequests: input.spend.unresolvedRequests, physicalRequests: input.spend.physicalRequests },
    timing: { startedAt: input.startedAt.toISOString(), finishedAt: input.finishedAt.toISOString(),
      durationSeconds: Math.max(0, (input.finishedAt.getTime() - input.startedAt.getTime()) / 1000) }
  });
}
