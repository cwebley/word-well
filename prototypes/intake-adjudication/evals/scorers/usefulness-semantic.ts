// The scorers that compare the gate against the owner's taste.
//
// Read these as a diagnostic, never as accuracy. At twelve binary cases each one
// is 8% of the score, so a single flip looks like a large move, and the label
// authority is one person. The plan is explicit: the golden set answers *what*
// broke; the retention audit across ~100 unlabelled endorsed words answers
// *that* something moved. Neither does both jobs.

import type { EvalScorer } from "braintrust";

import type { HeadwordOutcome } from "../../src/usefulness/run.ts";
import type { EvalInput, UsefulnessCase } from "../usefulness-datasets.ts";

type Scorer = EvalScorer<EvalInput, HeadwordOutcome, UsefulnessCase["expected"]>;

/**
 * Did the deterministic fold land on the disposition the bucket calls for?
 *
 * Lifted by: prompt clauses that trace to a named failing case, and by
 * correcting a label that turns out to be wrong. Check the label first — stage 1
 * and stage 2 both closed on the label being the error, not the judge.
 */
export const headwordDispositionScorer: Scorer = ({ output, expected }) => {
  if (!expected) return { name: "HeadwordDisposition", score: null, metadata: { reason: "unlabelled" } };
  return {
    name: "HeadwordDisposition",
    score: output.decision.disposition === expected.disposition ? 1 : 0,
    metadata: {
      expected: expected.disposition,
      actual: output.decision.disposition,
      bucket: expected.bucket,
      reason: output.decision.reason,
      verdicts: output.records.map((r) => r.finding?.usefulness ?? "none"),
    },
  };
};

/**
 * Which direction does a miss go?
 *
 * Not an accuracy measure — it is the asymmetry made visible. Selection is a
 * global hard exclude by product decision, so a wrong admit turns up in the app
 * and can be caught, while a wrong exclude is terminal and silent. Two gates
 * with the same score are not equally good if one of them fails downward.
 *
 * Scores 1 when the call is right or errs toward admitting, 0 when a word the
 * owner wanted is lost.
 *
 * Lifted by: nothing directly, and that is the point. It is a guard on the other
 * scorer — a prompt change that raises HeadwordDisposition while lowering this
 * one has bought accuracy with silent exclusions, which is a bad trade here.
 */
export const admitBiasScorer: Scorer = ({ output, expected }) => {
  if (!expected) return { name: "NoSilentExclusion", score: null, metadata: { reason: "unlabelled" } };
  const wrongExclude =
    expected.disposition === "advance" && output.decision.disposition === "exclude";
  return {
    name: "NoSilentExclusion",
    score: wrongExclude ? 0 : 1,
    metadata: {
      expected: expected.disposition,
      actual: output.decision.disposition,
      lost: wrongExclude ? expected.lemma : null,
    },
  };
};

export const usefulnessSemanticScorers = [headwordDispositionScorer, admitBiasScorer];
