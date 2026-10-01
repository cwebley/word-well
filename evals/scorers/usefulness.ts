// Scores usefulness verdicts against owner labels. Keep is the positive
// class: precision on keeps is the primary metric, recall the floor. Soft
// cases and incomplete cases are reported but never scored.
import type { Category, UsefulnessCase } from "../datasets/usefulness.js";
import type { UsefulnessResult } from "../../pipeline/stages/usefulness.js";

export type ScoredRow = { case: UsefulnessCase; result: UsefulnessResult | null };

export type Mistake = {
  headword: string;
  kind: "wrong_admit" | "wrong_exclude";
  category: Category;
  difficulty?: UsefulnessCase["difficulty"];
  keepScore: number;
};

type Tally = { cases: number; correct: number };

export type UsefulnessReport = {
  cases: number;
  incomplete: string[];
  counts: { truePositive: number; falsePositive: number; falseNegative: number; trueNegative: number };
  precision: number | null;
  recall: number | null;
  wrongAdmits: { too_familiar: number; too_specific: number; intake_should_catch: number };
  mistakes: Mistake[];
  byCategory: Partial<Record<Category, Tally>>;
  byDifficulty: Partial<Record<NonNullable<UsefulnessCase["difficulty"]>, Tally>>;
  soft: { cases: number; agreedWithLean: number; headwords: string[] };
  intakeShouldCatch: { cases: number; admitted: string[] };
  flips: string[];
};

export function scoreUsefulness(rows: ScoredRow[]): UsefulnessReport {
  const report: UsefulnessReport = {
    cases: rows.length,
    incomplete: [],
    counts: { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 },
    precision: null,
    recall: null,
    wrongAdmits: { too_familiar: 0, too_specific: 0, intake_should_catch: 0 },
    mistakes: [],
    byCategory: {},
    byDifficulty: {},
    soft: { cases: 0, agreedWithLean: 0, headwords: [] },
    intakeShouldCatch: { cases: 0, admitted: [] },
    flips: []
  };
  const tally = <K extends string>(table: Partial<Record<K, Tally>>, key: K, correct: boolean) => {
    const t = (table[key] ??= { cases: 0, correct: 0 });
    t.cases += 1;
    if (correct) t.correct += 1;
  };

  for (const { case: c, result } of rows) {
    if (!result) {
      report.incomplete.push(c.headword);
      continue;
    }
    if (new Set(result.trials.map((t) => t.verdict)).size > 1) report.flips.push(c.headword);
    const admitted = result.verdict === "advance";
    if (c.category === "soft") {
      report.soft.cases += 1;
      report.soft.headwords.push(c.headword);
      if (admitted === (c.expected === "keep")) report.soft.agreedWithLean += 1;
      continue;
    }
    const isKeep = c.category === "keep";
    const correct = admitted === isKeep;
    tally(report.byCategory, c.category, correct);
    if (c.difficulty) tally(report.byDifficulty, c.difficulty, correct);
    if (c.category === "intake_should_catch") {
      report.intakeShouldCatch.cases += 1;
      if (admitted) report.intakeShouldCatch.admitted.push(c.headword);
    }
    if (isKeep && admitted) report.counts.truePositive += 1;
    else if (isKeep) report.counts.falseNegative += 1;
    else if (admitted) report.counts.falsePositive += 1;
    else report.counts.trueNegative += 1;
    if (!correct) {
      if (admitted && c.category !== "keep") report.wrongAdmits[c.category] += 1;
      report.mistakes.push({
        headword: c.headword,
        kind: admitted ? "wrong_admit" : "wrong_exclude",
        category: c.category,
        difficulty: c.difficulty,
        keepScore: result.keepScore
      });
    }
  }

  const { truePositive: tp, falsePositive: fp, falseNegative: fn } = report.counts;
  report.precision = tp + fp > 0 ? tp / (tp + fp) : null;
  report.recall = tp + fn > 0 ? tp / (tp + fn) : null;
  return report;
}
