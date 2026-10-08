// Scores saved appropriateness trials against the owner's expected finding.
// Pass rule (owner, 2026-10-05, #15): all three trials valid, and no wrong
// accept on any trial or on the production average. Wrong rejects are the
// safer error: reported, but tolerated.
import { averageDecision, dispositionFor, TRIALS, type Disposition, type Thresholds } from "../../pipeline/stages/appropriateness.js";

export type Finding = "clear" | "blocked";
export type TrialOutcome =
  | { state: "valid"; blockedProbability: number; slurProbability?: number | null; vulgarProbability?: number | null }
  | { state: "invalid" | "failed" | "uncertain" | "response_lost" | "verification_unresolved" };
type Direction = "wrong_accept" | "wrong_reject" | null;

export type TrialScore = { state: TrialOutcome["state"]; disposition: Disposition | null; correct: boolean | null; error: Direction };
export type CaseScore = {
  trials: TrialScore[];
  averaged: { blockedProbability: number | null; slurProbability?: number | null; vulgarProbability?: number | null; disposition: Disposition | null; correct: boolean | null; error: Direction };
  allThreeCorrect: boolean;
  unstable: boolean;
  complete: boolean;
  pass: boolean;
};

function judge(expected: Finding, disposition: Disposition): { correct: boolean; error: Direction } {
  const wanted: Disposition = expected === "blocked" ? "reject" : "accept";
  if (disposition === wanted) return { correct: true, error: null };
  return { correct: false, error: disposition === "accept" ? "wrong_accept" : "wrong_reject" };
}

// `trials` holds saved terminal outcomes in trial order; absent trials are missing.
// Thresholds come from the experiment's saved configuration (default 0.50 each).
export function scoreCase(expected: Finding, trials: TrialOutcome[], thresholds?: Thresholds): CaseScore {
  const scored: TrialScore[] = trials.map(trial => {
    if (trial.state !== "valid") return { state: trial.state, disposition: null, correct: null, error: null };
    const disposition = dispositionFor({ blocked: trial.blockedProbability, slur: trial.slurProbability ?? null, vulgar: trial.vulgarProbability ?? null }, thresholds);
    return { state: "valid", disposition, ...judge(expected, disposition) };
  });
  const average = averageDecision(Array.from({ length: TRIALS }, (_, i) => {
    const trial = trials[i];
    return trial?.state === "valid" ? { blocked: trial.blockedProbability, slur: trial.slurProbability ?? null, vulgar: trial.vulgarProbability ?? null } : null;
  }), thresholds);
  const averaged = average
    ? { blockedProbability: average.blockedProbability, ...(average.slurProbability === null ? {} : { slurProbability: average.slurProbability }),
        ...(average.vulgarProbability === null ? {} : { vulgarProbability: average.vulgarProbability }),
        disposition: average.disposition, ...judge(expected, average.disposition) }
    : { blockedProbability: null, disposition: null, correct: null, error: null };
  const allThreeCorrect = scored.length === TRIALS && scored.every(trial => trial.correct === true);
  const dispositions = new Set(scored.filter(trial => trial.disposition).map(trial => trial.disposition));
  return {
    trials: scored, averaged, allThreeCorrect,
    unstable: dispositions.size > 1,
    complete: trials.length === TRIALS,
    pass: scored.length === TRIALS && scored.every(trial => trial.state === "valid" && trial.error !== "wrong_accept") &&
      averaged.disposition !== null && averaged.error !== "wrong_accept"
  };
}

export type ExperimentSummary = {
  cases: number; requiredTrials: number;
  validTrials: number; invalidTrials: number; failedTrials: number; unresolvedTrials: number; missingTrials: number;
  trialWrongAccepts: number; trialWrongRejects: number; averagedWrongAccepts: number; averagedWrongRejects: number;
  casesAllThreeCorrect: number; unstableCases: number; passedCases: number;
  goldenRequirementsPass: boolean;
};

export function summarize(scores: CaseScore[]): ExperimentSummary {
  const trials = scores.flatMap(score => score.trials);
  const count = <T>(items: T[], test: (item: T) => boolean) => items.filter(test).length;
  const requiredTrials = scores.length * TRIALS;
  return {
    cases: scores.length, requiredTrials,
    validTrials: count(trials, t => t.state === "valid"),
    invalidTrials: count(trials, t => t.state === "invalid"),
    failedTrials: count(trials, t => t.state === "failed" || t.state === "response_lost"),
    unresolvedTrials: count(trials, t => t.state === "uncertain" || t.state === "verification_unresolved"),
    missingTrials: requiredTrials - trials.length,
    trialWrongAccepts: count(trials, t => t.error === "wrong_accept"),
    trialWrongRejects: count(trials, t => t.error === "wrong_reject"),
    averagedWrongAccepts: count(scores, s => s.averaged.error === "wrong_accept"),
    averagedWrongRejects: count(scores, s => s.averaged.error === "wrong_reject"),
    casesAllThreeCorrect: count(scores, s => s.allThreeCorrect),
    unstableCases: count(scores, s => s.unstable),
    passedCases: count(scores, s => s.pass),
    goldenRequirementsPass: scores.length > 0 && scores.every(s => s.pass)
  };
}
