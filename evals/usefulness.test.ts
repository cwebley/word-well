// @vitest-environment node
import { describe, expect, it } from "vitest";
import { JevError, type JevAnswers, type JevClient } from "../pipeline/execution/jev.js";
import { FEATURE_NAMES, loadCombiner, QUESTIONS } from "../pipeline/stages/usefulness.js";
import type { UsefulnessCase } from "./datasets/usefulness.js";
import { runUsefulnessEval } from "./usefulness.js";

const combiner = loadCombiner({
  id: "fixture-combiner",
  input_feature_names: FEATURE_NAMES,
  feature_names: ["usefulness.meaning_obviousness"],
  mean: [0], scale: [1], coefficients: [-10], intercept: 1, threshold: 0.5
});

function answers(obviousness: number): JevAnswers {
  const out: JevAnswers = {};
  for (const [name, q] of Object.entries(QUESTIONS)) {
    if (q.type === "noul") out[name] = { type: "noul", noul: name === "meaning_obviousness" ? obviousness : 0.5 };
    else if (q.type === "score") out[name] = { type: "score", score: 0, probabilities: Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 0 ? 1 : 0])), confidence: 1 };
    else {
      const keys = Object.keys(q.criteria);
      out[name] = { type: "choice", choice: keys[0], probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0])), confidence: 1 };
    }
  }
  return out;
}

const cases: UsefulnessCase[] = [
  { id: "w1", headword: "parlance", partsOfSpeech: ["n"], expected: "keep", category: "keep", difficulty: "clear" },
  { id: "w2", headword: "nuance", partsOfSpeech: ["n"], expected: "exclude", category: "too_familiar", difficulty: "clear" },
  { id: "w3", headword: "fetid", partsOfSpeech: ["a"], expected: "keep", category: "keep", difficulty: "clear" }
];

// Jev by headword: obviousness 0 -> advance, 0.5 -> exclude.
function jevFor(byHeadword: Record<string, number | JevError>): JevClient {
  return {
    async ask(request) {
      const headword = request.state.split("\n")[1].replace("word: ", "");
      const value = byHeadword[headword];
      if (value instanceof JevError) throw value;
      return answers(value);
    }
  };
}

describe("runUsefulnessEval", () => {
  it("judges every case and scores the verdicts", async () => {
    const run = await runUsefulnessEval({ cases, combiner, jev: jevFor({ parlance: 0, nuance: 0.5, fetid: 0 }) });

    expect(run.rows.map((r) => r.result?.verdict)).toEqual(["advance", "exclude", "advance"]);
    expect(run.report.precision).toBe(1);
    expect(run.report.recall).toBe(1);
    expect(run.error).toBeNull();
  });

  it("marks a case with no saved answers incomplete and carries on", async () => {
    const jev = jevFor({ parlance: 0, nuance: new JevError("not_saved", "none"), fetid: 0 });

    const run = await runUsefulnessEval({ cases, combiner, jev });

    expect(run.report.incomplete).toEqual(["nuance"]);
    expect(run.rows[2].result?.verdict).toBe("advance");
    expect(run.error).toBeNull();
  });

  it.each(["http", "uncertain", "cap_reached", "wrong_model"] as const)(
    "stops at a %s failure, which would repeat on every call, and leaves the rest incomplete", async (kind) => {
      const jev = jevFor({ parlance: 0, nuance: new JevError(kind, "failed"), fetid: 0 });

      const run = await runUsefulnessEval({ cases, combiner, jev });

      expect(run.error).toEqual({ kind, message: "failed", headword: "nuance" });
      expect(run.report.incomplete).toEqual(["nuance", "fetid"]);
    });

  it("marks a word with an invalid reply incomplete, records why, and carries on", async () => {
    const jev = jevFor({ parlance: 0, nuance: new JevError("invalid", "concept: bad distribution"), fetid: 0 });

    const run = await runUsefulnessEval({ cases, combiner, jev });

    expect(run.error).toBeNull();
    expect(run.report.incomplete).toEqual(["nuance"]);
    expect(run.failures).toEqual([{ headword: "nuance", kind: "invalid", message: "concept: bad distribution" }]);
    expect(run.rows[2].result?.verdict).toBe("advance");
  });

  it("stops after three invalid replies, since that many suggests something systemic", async () => {
    const more: UsefulnessCase[] = ["a", "b", "c", "d"].map((h) => ({ ...cases[1], id: h, headword: h }));
    const bad = new JevError("invalid", "bad");
    const jev = jevFor({ a: bad, b: bad, c: bad, d: 0 });

    const run = await runUsefulnessEval({ cases: more, combiner, jev });

    expect(run.error).toMatchObject({ kind: "invalid", headword: "c" });
    expect(run.report.incomplete).toEqual(["a", "b", "c", "d"]);
  });
});
