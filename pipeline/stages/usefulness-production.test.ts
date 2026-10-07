// @vitest-environment node
import { describe, expect, it } from "vitest";
import sourceArtifact from "../../config/usefulness-combiner-e9d29c215805.json" with { type: "json" };
import type { JevAnswers, JevClient } from "../execution/jev.js";
import { judgeUsefulness, loadCombiner, QUESTIONS } from "./usefulness.js";
import { PRODUCTION_COMBINER } from "./usefulness-production.js";
import { createUsefulnessStage, usefulnessConfiguration } from "./usefulness.js";
import { PINNED_MODEL_VERSION } from "../execution/jev.js";

// Synthetic measurements chosen to distinguish the original 0.50 cutoff from
// the promoted 0.58 cutoff. They contain no owner labels or held-out words.
function measurements(recognition: number): JevAnswers {
  const answers: JevAnswers = {};
  for (const [name, question] of Object.entries(QUESTIONS)) {
    if (question.type === "noul") answers[name] = { type: "noul", noul: 0 };
    else if (question.type === "score") {
      answers[name] = { type: "score", score: 3, probabilities: { "0": 0, "1": 0, "2": 0, "3": 1 }, confidence: 1 };
    } else {
      const options = Object.keys(question.criteria);
      answers[name] = { type: "choice", choice: options[0],
        probabilities: Object.fromEntries(options.map((name, i) => [name, i === 0 ? 1 : 0])), confidence: 1 };
    }
  }
  answers.prior_recognition = { type: "score", score: recognition,
    probabilities: { "0": 0, "1": 2 - recognition, "2": recognition - 1, "3": 0 }, confidence: 2 * recognition - 3 };
  return answers;
}

describe("production usefulness configuration", () => {
  it("preserves the fit's scores but excludes a candidate between the old and approved cutoffs under a new identity", async () => {
    const byTrial = [measurements(1.85), measurements(1.9), measurements(1.95)];
    const jev: JevClient = { async ask(_request, trial) { return byTrial[trial - 1]; } };
    const subject = { headword: "fixture", partsOfSpeech: ["n"] };
    const original = await judgeUsefulness(subject, loadCombiner(sourceArtifact), jev);
    const promoted = await judgeUsefulness(subject, PRODUCTION_COMBINER, jev);

    expect(PRODUCTION_COMBINER.threshold).toBe(0.58);
    expect(sourceArtifact.threshold).toBe(0.5);
    expect(promoted.keepScore).toBe(original.keepScore);
    expect(promoted.keepScore).toBeGreaterThan(0.5);
    expect(promoted.keepScore).toBeLessThan(0.58);
    expect(original.verdict).toBe("advance");
    expect(promoted.verdict).toBe("exclude");
    expect(promoted.trials.map(t => t.verdict)).toEqual(["advance", "exclude", "exclude"]);
    expect(promoted.configId).not.toBe(original.configId);
  });

  it("advances a candidate above the approved cutoff", async () => {
    const jev: JevClient = { async ask() { return measurements(1.8); } };
    const result = await judgeUsefulness({ headword: "fixture", partsOfSpeech: ["n"] }, PRODUCTION_COMBINER, jev);

    expect(result.keepScore).toBeGreaterThan(0.58);
    expect(result.verdict).toBe("advance");
  });
  it("retains measured rounded-choice tie handling and rejects unpinned or invalid raw replies", () => {
    const stage = createUsefulnessStage(usefulnessConfiguration(PRODUCTION_COMBINER));
    const answers = measurements(1.8), choice = Object.entries(QUESTIONS).find(([, q]) => q.type === "choice")!;
    const keys = Object.keys(choice[1].criteria), [a, b] = keys;
    answers[choice[0]] = { type: "choice", choice: a, probabilities: Object.fromEntries(keys.map(k => [k, k === a ? 0.50 : k === b ? 0.49 : 0])), confidence: 0.5 };
    const reply = (model = PINNED_MODEL_VERSION) => JSON.stringify({ model, answers });
    const valid = stage.validate(reply());
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.result.answers[choice[0]]).toMatchObject({ choice: b });
    expect(stage.validate(reply("wrong/model"))).toEqual({ ok: false, code: "wrong_model" });
    expect(stage.validate("{")).toEqual({ ok: false, code: "malformed_reply" });
    answers[choice[0]] = { type: "choice", choice: a, probabilities: { [a]: 0.1 }, confidence: 0.5 };
    expect(stage.validate(reply())).toEqual({ ok: false, code: "answers_invalid" });
  });
});
