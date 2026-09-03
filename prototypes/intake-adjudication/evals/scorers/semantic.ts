// Semantic scorers. These compare the judgment against a label, so they are only
// as good as the labels — and at stage 1 the labels are the author's reading of
// the evidence, not a human labelling pass. Read them as a smoke test.
//
// Predictability returns null unless the analysis is expected to be supported.
// "Does this meaning follow from the root?" is not a question you can be right
// or wrong about when there is no root, and averaging a verdict in there would
// make the metric worse the more honest the judge is.

import type { EvalScorer } from "braintrust";

import type { Claim } from "../../src/morphology/claim.ts";
import type { Finding } from "../../src/morphology/contract.ts";
import type { AdjudicationRecord } from "../../src/store.ts";
import type { ExpectedLabel } from "../types.ts";

type Scorer = EvalScorer<Claim, AdjudicationRecord<Finding>, ExpectedLabel>;

export const analysisSupportScorer: Scorer = ({ output, expected }) => {
  if (!expected) return null;
  if (!output.finding) {
    return { name: "AnalysisSupport", score: 0, metadata: { reason: "no valid finding" } };
  }
  return {
    name: "AnalysisSupport",
    score: output.finding.analysis_support === expected.analysis_support ? 1 : 0,
    metadata: { expected: expected.analysis_support, actual: output.finding.analysis_support },
  };
};

export const predictabilityScorer: Scorer = ({ output, expected }) => {
  if (!expected || expected.analysis_support !== "supported") return null;
  if (!output.finding) {
    return { name: "MeaningPredictability", score: 0, metadata: { reason: "no valid finding" } };
  }

  const actual = new Map<string, string>();
  for (const meaning of output.finding.meanings) {
    for (const senseId of meaning.sense_ids) actual.set(senseId, meaning.predictability);
  }

  const disagreements: { sense_id: string; expected: string; actual: string | undefined }[] = [];
  let agreed = 0;
  for (const meaning of expected.meanings) {
    const got = actual.get(meaning.sense_id);
    if (got === meaning.predictability) agreed += 1;
    else disagreements.push({ sense_id: meaning.sense_id, expected: meaning.predictability, actual: got });
  }

  return {
    name: "MeaningPredictability",
    score: expected.meanings.length === 0 ? 0 : agreed / expected.meanings.length,
    metadata: { judged: expected.meanings.length, disagreements },
  };
};

export const semanticScorers = [analysisSupportScorer, predictabilityScorer];
