// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { UsefulnessCase } from "../datasets/usefulness.js";
import type { UsefulnessResult, Verdict } from "../../pipeline/stages/usefulness.js";
import { scoreUsefulness } from "./usefulness.js";

let nextId = 0;
function row(headword: string, category: UsefulnessCase["category"], verdict: Verdict | null,
  { expected, difficulty = "clear", trialVerdicts }: { expected?: "keep" | "exclude"; difficulty?: "clear" | "hard"; trialVerdicts?: Verdict[] } = {}) {
  const c: UsefulnessCase = {
    id: `word-${nextId++}`, headword, partsOfSpeech: ["n"], category, difficulty,
    expected: expected ?? (category === "keep" ? "keep" : "exclude")
  };
  if (verdict === null) return { case: c, result: null };
  const result: UsefulnessResult = {
    verdict,
    keepScore: verdict === "advance" ? 0.7 : 0.3,
    trials: (trialVerdicts ?? [verdict, verdict, verdict]).map((v) => ({ answers: {}, keepScore: v === "advance" ? 0.7 : 0.3, verdict: v })),
    configId: "config"
  };
  return { case: c, result };
}

// Worked example: 1 keep admitted, 1 keep excluded, a too-familiar and an
// intake word admitted, a too-specific word excluded.
// TP 1, FN 1, FP 2, TN 1 -> precision 1/3, recall 1/2.
const example = [
  row("parlance", "keep", "advance"),
  row("pernicious", "keep", "exclude", { difficulty: "hard" }),
  row("nuance", "too_familiar", "advance"),
  row("xiii", "intake_should_catch", "advance"),
  row("isthmus", "too_specific", "exclude"),
  row("kibosh", "soft", "exclude", { expected: "keep" }),
  row("fetid", "keep", null)
];

describe("scoreUsefulness", () => {
  it("scores precision and recall on keeps over firm, completed cases", () => {
    const report = scoreUsefulness(example);

    expect(report.counts).toEqual({ truePositive: 1, falsePositive: 2, falseNegative: 1, trueNegative: 1 });
    expect(report.precision).toBeCloseTo(1 / 3, 10);
    expect(report.recall).toBe(0.5);
  });

  it("counts wrong admits by type and names every mistake", () => {
    const report = scoreUsefulness(example);

    expect(report.wrongAdmits).toEqual({ too_familiar: 1, too_specific: 0, intake_should_catch: 1 });
    expect(report.mistakes.map((m) => [m.headword, m.kind])).toEqual([
      ["pernicious", "wrong_exclude"],
      ["nuance", "wrong_admit"],
      ["xiii", "wrong_admit"]
    ]);
  });

  it("reports soft cases apart from the score, against the owner's lean", () => {
    const report = scoreUsefulness(example);

    expect(report.soft).toEqual({ cases: 1, agreedWithLean: 0, headwords: ["kibosh"] });
  });

  it("keeps incomplete cases in the denominator report instead of dropping them", () => {
    const report = scoreUsefulness(example);

    expect(report.cases).toBe(7);
    expect(report.incomplete).toEqual(["fetid"]);
  });

  it("gives intake_should_catch words their own line", () => {
    const report = scoreUsefulness(example);

    expect(report.intakeShouldCatch).toEqual({ cases: 1, admitted: ["xiii"] });
  });

  it("scores each category and difficulty separately", () => {
    const report = scoreUsefulness(example);

    expect(report.byCategory.keep).toEqual({ cases: 2, correct: 1 });
    expect(report.byCategory.too_specific).toEqual({ cases: 1, correct: 1 });
    expect(report.byDifficulty.hard).toEqual({ cases: 1, correct: 0 });
    expect(report.byDifficulty.clear).toEqual({ cases: 4, correct: 2 });
  });

  it("lists words whose trials disagree, even when the averaged verdict is right", () => {
    const report = scoreUsefulness([
      row("parlance", "keep", "advance", { trialVerdicts: ["advance", "exclude", "advance"] }),
      row("nuance", "too_familiar", "exclude")
    ]);

    expect(report.flips).toEqual(["parlance"]);
  });

  it("reports precision as null when nothing was admitted", () => {
    const report = scoreUsefulness([row("parlance", "keep", "exclude")]);

    expect(report.precision).toBeNull();
    expect(report.recall).toBe(0);
  });
});
