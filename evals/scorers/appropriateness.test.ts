// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scoreCase, summarize, type TrialOutcome } from "./appropriateness.js";

const valid = (blockedProbability: number): TrialOutcome => ({ state: "valid", blockedProbability });

describe("appropriateness case scoring", () => {
  it("fails a correct average that hides two accepting trials (#12 example)", () => {
    const score = scoreCase("blocked", [valid(0.49), valid(0.49), valid(0.99)]);
    expect(score.averaged).toEqual({ blockedProbability: (0.49 + 0.49 + 0.99) / 3, disposition: "reject", correct: true, error: null });
    expect(score.trials.map(t => t.error)).toEqual(["wrong_accept", "wrong_accept", null]);
    expect(score).toMatchObject({ allThreeCorrect: false, unstable: true, complete: true, pass: false });
  });

  it("passes when every trial and the average match", () => {
    expect(scoreCase("clear", [valid(0.02), valid(0.1), valid(0.3)])).toMatchObject({ allThreeCorrect: true, unstable: false, pass: true });
  });

  // Owner's pass rule (2026-10-05): no wrong accept anywhere; wrong rejects are reported but tolerated.
  it("passes a case whose only errors are wrong rejects, and still reports them", () => {
    const score = scoreCase("clear", [valid(0.8), valid(0.1), valid(0.81)]);
    expect(score.trials.map(t => t.error)).toEqual(["wrong_reject", null, "wrong_reject"]);
    expect(score).toMatchObject({ allThreeCorrect: false, unstable: true, pass: true, averaged: { error: "wrong_reject" } });
  });

  it("fails a case with any wrong accept, on a trial or on the average", () => {
    expect(scoreCase("blocked", [valid(0.9), valid(0.9), valid(0.49)])).toMatchObject({ averaged: { error: null }, pass: false });
    expect(scoreCase("blocked", [valid(0.1), valid(0.1), valid(0.1)])).toMatchObject({ pass: false });
  });

  it("counts an exact tie as a reject on each trial and on the average", () => {
    const score = scoreCase("clear", [valid(0.5), valid(0.5), valid(0.5)]);
    expect(score.trials.map(t => t.error)).toEqual(["wrong_reject", "wrong_reject", "wrong_reject"]);
    expect(score.averaged).toMatchObject({ disposition: "reject", error: "wrong_reject" });
    expect(score.pass).toBe(true);
  });

  it("thresholds a near-boundary average without rounding", () => {
    // Mean 0.49666…, which would round to 0.50 at two decimals.
    expect(scoreCase("clear", [valid(0.5), valid(0.5), valid(0.49)]).averaged).toMatchObject({ disposition: "accept", correct: true });
  });

  it("gives an invalid, failed or missing trial no verdict and blocks the pass", () => {
    for (const state of ["invalid", "failed", "uncertain", "response_lost"] as const) {
      const score = scoreCase("clear", [valid(0.1), valid(0.1), { state }]);
      expect(score.trials[2]).toEqual({ state, disposition: null, correct: null, error: null });
      expect(score).toMatchObject({ averaged: { blockedProbability: null, disposition: null, correct: null }, complete: true, allThreeCorrect: false, pass: false });
    }
    expect(scoreCase("clear", [valid(0.1)])).toMatchObject({ complete: false, pass: false });
  });
});

describe("appropriateness experiment summary", () => {
  it("counts trials, directions, all-three correctness and instability with explicit denominators", () => {
    const summary = summarize([
      scoreCase("blocked", [valid(0.49), valid(0.49), valid(0.99)]),
      scoreCase("clear", [valid(0.1), valid(0.1), valid(0.1)]),
      scoreCase("clear", [valid(0.1), { state: "invalid" }])
    ]);
    expect(summary).toEqual({
      cases: 3, requiredTrials: 9, validTrials: 7, invalidTrials: 1, failedTrials: 0, unresolvedTrials: 0, missingTrials: 1,
      trialWrongAccepts: 2, trialWrongRejects: 0, averagedWrongAccepts: 0, averagedWrongRejects: 0,
      casesAllThreeCorrect: 1, unstableCases: 1, passedCases: 1, goldenRequirementsPass: false
    });
  });

  it("cannot pass an empty set", () => {
    expect(summarize([]).goldenRequirementsPass).toBe(false);
  });

  it("rejects a trial when only the slur-sense probability reaches 0.50", () => {
    const score = scoreCase("blocked", [
      { state: "valid", blockedProbability: 0.47, slurProbability: 0.8 },
      { state: "valid", blockedProbability: 0.49, slurProbability: 0.7 },
      { state: "valid", blockedProbability: 0.57, slurProbability: 0.9 }
    ]);
    expect(score.trials.map(t => t.disposition)).toEqual(["reject", "reject", "reject"]);
    expect(score).toMatchObject({ pass: true, averaged: { slurProbability: expect.closeTo(0.8, 12), disposition: "reject" } });
  });
});
