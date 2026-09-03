// Deterministic usefulness policy. Versioned, and deliberately narrow.
//
// Two functions because there are two levels. The judge answers per meaning;
// the pool serves or drops a headword. `deriveUsefulness` reads one verdict,
// `deriveHeadwordDisposition` folds a headword's meanings together.

import type { DispositionResult } from "../disposition.ts";
import type { ExamLevel, UsefulnessFinding } from "./contract.ts";

export const POLICY_VERSION = "usefulness-policy/2";

export type Usefulness = "useful" | "not_useful" | "insufficient_evidence";

/**
 * One meaning's disposition, from the verdict field and nothing else.
 *
 * The signature is the guarantee: `diagnostic_confidence` is structurally
 * unreachable here rather than merely unused, so a later edit cannot start
 * letting the model's self-confidence decide what gets served without changing
 * this function's shape.
 */
export function deriveUsefulness(usefulness: Usefulness): DispositionResult {
  switch (usefulness) {
    case "useful":
      return { disposition: "advance", reason: "this meaning is worth learning for the audience" };
    case "not_useful":
      return { disposition: "exclude", reason: "this meaning is not worth learning for the audience" };
    case "insufficient_evidence":
      return {
        disposition: "quarantine",
        reason: "the evidence cannot settle whether this meaning is worth learning",
      };
  }
}

/** Maps the recorded exam category to the gate's internal usefulness verdict. */
export function usefulnessOfExamLevel(level: ExamLevel): Usefulness {
  switch (level) {
    case "high_school":
    case "college":
    case "postgraduate":
      return "useful";
    case "ordinary":
    case "middle_school":
    case "specialist_subject":
      return "not_useful";
    case "insufficient_evidence":
      return "insufficient_evidence";
  }
}

export function deriveExamLevel(level: ExamLevel): DispositionResult {
  return deriveUsefulness(usefulnessOfExamLevel(level));
}

/**
 * A headword's disposition, folded from its meanings.
 *
 * One useful meaning is enough to keep the word, which is both the acceptance
 * criterion — a polysemous headword must not lose a good meaning to a bad one —
 * and the right way to be wrong. Selection is a global hard exclude by product
 * decision, so a wrong admit surfaces in the app and a wrong exclude is terminal
 * and silent. The fold leans toward admitting on purpose.
 *
 * Order matters. An undecided meaning cannot take away a decided `useful` one,
 * for the same reason `morphology-policy/2` reordered: a judge that is unsure
 * about some meanings while certain about one should not lose the certainty.
 */
export function deriveHeadwordDisposition(verdicts: Usefulness[]): DispositionResult {
  if (verdicts.length === 0) {
    return { disposition: "quarantine", reason: "no meaning was judged" };
  }
  if (verdicts.includes("useful")) {
    return {
      disposition: "advance",
      reason: "at least one meaning is worth learning for the audience",
    };
  }
  if (verdicts.includes("insufficient_evidence")) {
    return {
      disposition: "quarantine",
      reason: "no meaning was shown to be worth learning, and at least one could not be judged",
    };
  }
  return {
    disposition: "exclude",
    reason: "no meaning of this word is worth learning for the audience",
  };
}

/** Reads the one policy-relevant field off a finding, and only that one. */
export function verdictOf(finding: UsefulnessFinding): Usefulness {
  return usefulnessOfExamLevel(finding.exam_level);
}
