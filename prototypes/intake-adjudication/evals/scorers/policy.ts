// Policy scorers. These score the disposition the deterministic policy derived,
// not anything the model said about what should happen.
//
// Two of them because the plan keeps the layers separate: morphology's own
// verdict, and the effective disposition after endorsement is allowed to
// override a fuzzy exclusion. A regression in the override rule shows up as a
// gap between the two, which a single combined score would hide.

import type { EvalScorer } from "braintrust";

import type { Claim } from "../../src/morphology/claim.ts";
import type { Finding } from "../../src/morphology/contract.ts";
import type { AdjudicationRecord } from "../../src/store.ts";
import type { ExpectedLabel } from "../types.ts";

type Scorer = EvalScorer<Claim, AdjudicationRecord<Finding>, ExpectedLabel>;

export const morphologyDispositionScorer: Scorer = ({ output, expected }) => {
  if (!expected) return null;
  const actual = output.decision?.disposition;
  return {
    name: "MorphologyDisposition",
    score: actual === expected.morphology_disposition ? 1 : 0,
    metadata: {
      expected: expected.morphology_disposition,
      actual: actual ?? "none (no valid finding)",
      reason: output.decision?.reason,
    },
  };
};

export const effectiveDispositionScorer: Scorer = ({ output, expected }) => {
  if (!expected) return null;
  const actual = output.effective?.disposition;
  return {
    name: "EffectiveDisposition",
    score: actual === expected.effective_disposition ? 1 : 0,
    metadata: {
      expected: expected.effective_disposition,
      actual: actual ?? "none (no valid finding)",
      endorsements: output.policy_context.endorsements,
      endorsementOverride: output.effective?.overridden ?? false,
    },
  };
};

export const policyScorers = [morphologyDispositionScorer, effectiveDispositionScorer];
