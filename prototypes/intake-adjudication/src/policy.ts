// Deterministic intake policy. Versioned, and deliberately narrow.
//
// `deriveMorphologyDisposition` takes the two verdict fields and nothing else.
// That is the point: the plan requires that model self-confidence can never
// control disposition, and the cheapest way to guarantee that is to make it
// structurally unreachable rather than merely unused. A future edit cannot
// start reading `diagnostic_confidence` here without changing the signature.
//
// Endorsement is applied afterwards, by a separate function, because the four
// layers — mechanical attributes, judge findings, endorsement, and effective
// disposition — stay separate records.

import type { AnalysisSupport, Finding, Predictability } from "./contract.ts";

export const POLICY_VERSION = "morphology-policy/2";

export const dispositions = ["advance", "quarantine", "exclude"] as const;
export type Disposition = (typeof dispositions)[number];

export interface DispositionResult {
  disposition: Disposition;
  reason: string;
}

export interface MorphologyVerdict {
  analysisSupport: AnalysisSupport;
  predictabilities: Predictability[];
}

/**
 * Morphology's own disposition, before endorsement is considered.
 *
 * Exclude is the narrow case: the mechanical rule told the truth about how the
 * word is built, and every meaning follows from the parts, so the word teaches
 * nothing the learner cannot already derive. Everything uncertain quarantines
 * and everything else advances to the later gates.
 */
export function deriveMorphologyDisposition(verdict: MorphologyVerdict): DispositionResult {
  const { analysisSupport, predictabilities } = verdict;

  if (analysisSupport === "insufficient_evidence") {
    return {
      disposition: "quarantine",
      reason: "the evidence cannot settle whether the claimed analysis holds",
    };
  }

  if (analysisSupport === "unsupported") {
    return {
      disposition: "advance",
      reason: "the mechanical rule invented a decomposition the evidence does not support",
    };
  }

  if (predictabilities.length === 0) {
    return {
      disposition: "quarantine",
      reason: "the analysis is supported but no meaning was judged",
    };
  }

  // Order matters, and this order is v2. A single meaning that demonstrably does
  // not follow from the parts is a sufficient reason to keep the word, and no
  // undecided meaning alongside it can take that reason away. Checking for
  // uncertainty first let one undecided meaning quarantine a word we already had
  // grounds to advance — which is exactly how two runs of the same fingerprint
  // reached different dispositions for `mercurial` at stage 1.
  if (predictabilities.includes("not_predictable")) {
    return {
      disposition: "advance",
      reason: "at least one meaning does not follow from the claimed root or components",
    };
  }

  if (predictabilities.includes("insufficient_evidence")) {
    return {
      disposition: "quarantine",
      reason: "no meaning was shown to teach anything new, and at least one could not be judged",
    };
  }

  return {
    disposition: "exclude",
    reason: "the analysis is supported and every meaning follows from the claimed parts",
  };
}

/**
 * Endorsement overrides fuzzy morphology, never a factual filter.
 *
 * An editor who put a word on a study guide has better evidence than a string
 * heuristic, so an endorsed word is not excluded by one. It cannot rescue a word
 * from quarantine: quarantine means nobody knows yet, and a nomination list does
 * not supply the missing lexical evidence.
 */
export function applyEndorsement(
  morphology: DispositionResult,
  endorsements: number,
): DispositionResult & { endorsementOverride: boolean } {
  if (morphology.disposition === "exclude" && endorsements > 0) {
    return {
      disposition: "advance",
      reason: `endorsed by ${endorsements} editorial source${endorsements === 1 ? "" : "s"}, which overrides a fuzzy morphology exclusion`,
      endorsementOverride: true,
    };
  }
  return { ...morphology, endorsementOverride: false };
}

/** Reads the two policy-relevant fields off a finding, and only those two. */
export function verdictOf(finding: Finding): MorphologyVerdict {
  return {
    analysisSupport: finding.analysis_support,
    predictabilities: finding.meanings.map((m) => m.predictability),
  };
}
