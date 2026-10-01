// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Answer, JevAnswers, JevClient, JevRequest } from "../execution/jev.js";
import { judgeUsefulness, loadCombiner, QUESTIONS } from "./usefulness.js";

// Neutral answers for all nine questions; tests override the ones they need.
function answers(overrides: Partial<Record<string, Answer>> = {}): JevAnswers {
  const base: JevAnswers = {};
  for (const [name, q] of Object.entries(QUESTIONS)) {
    if (q.type === "noul") base[name] = { type: "noul", noul: 0.5 };
    else if (q.type === "score") {
      const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 1 ? 1 : 0]));
      base[name] = { type: "score", score: 1, probabilities, confidence: 1 };
    } else {
      const keys = Object.keys(q.criteria);
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 1 : 0]));
      base[name] = { type: "choice", choice: keys[0], probabilities, confidence: 1 };
    }
  }
  return { ...base, ...overrides } as JevAnswers;
}

function fakeJev(byTrial: Record<number, JevAnswers>) {
  const calls: { request: JevRequest; trial: number }[] = [];
  const client: JevClient = {
    async ask(request, trial) {
      calls.push({ request, trial });
      return byTrial[trial];
    }
  };
  return { client, calls };
}

const obviousness = (noul: number) => answers({ meaning_obviousness: { type: "noul", noul } });

// One feature, so expected keep scores are hand-computable:
// logit = 1 - 10 * obviousness, keep score = sigmoid(logit).
function obviousnessOnlyArtifact() {
  const inputs = Object.entries(QUESTIONS).flatMap(([name, q]) =>
    q.type === "choice" ? Object.keys(q.criteria).map((k) => `usefulness.${name}.${k}`) : [`usefulness.${name}`]);
  return {
    schema: "wordwell-inclusion-fit/v2",
    id: "fixture-combiner",
    input_feature_names: inputs.sort(),
    feature_names: ["usefulness.meaning_obviousness"],
    mean: [0],
    scale: [1],
    coefficients: [-10],
    intercept: 1,
    threshold: 0.5
  };
}

describe("judgeUsefulness", () => {
  it("asks Jev three trials about the headword and its recorded parts of speech", async () => {
    const jev = fakeJev({ 1: obviousness(0.1), 2: obviousness(0.1), 3: obviousness(0.1) });

    await judgeUsefulness({ headword: "parlance", partsOfSpeech: ["n"] }, loadCombiner(obviousnessOnlyArtifact()), jev.client);

    expect(jev.calls.map((c) => c.trial).sort()).toEqual([1, 2, 3]);
    for (const { request } of jev.calls) {
      expect(request).toEqual({
        model: "typesafe/jev-1.13",
        state: "HEADWORD\nword: parlance\nrecorded parts of speech: n",
        questions: QUESTIONS
      });
    }
  });

  it("decides on the averaged trials and keeps each trial's own verdict", async () => {
    // Mean obviousness 0.2: logit -1, keep score 0.268941 -> exclude.
    // Trial alone: 0.1 -> logit 0 -> 0.5 (advance); 0.4 -> logit -3 -> 0.047426.
    const jev = fakeJev({ 1: obviousness(0.1), 2: obviousness(0.1), 3: obviousness(0.4) });

    const result = await judgeUsefulness({ headword: "parlance", partsOfSpeech: ["n"] }, loadCombiner(obviousnessOnlyArtifact()), jev.client);

    expect(result.verdict).toBe("exclude");
    expect(result.keepScore).toBeCloseTo(0.268941, 6);
    expect(result.trials.map((t) => t.verdict)).toEqual(["advance", "advance", "exclude"]);
    expect(result.trials[2].keepScore).toBeCloseTo(0.047426, 6);
    expect(result.trials[0].answers.meaning_obviousness).toEqual({ type: "noul", noul: 0.1 });
  });

  it("writes 'none recorded' when the headword has no recorded part of speech", async () => {
    const jev = fakeJev({ 1: obviousness(0), 2: obviousness(0), 3: obviousness(0) });

    const result = await judgeUsefulness({ headword: "xiii", partsOfSpeech: [] }, loadCombiner(obviousnessOnlyArtifact()), jev.client);

    expect(jev.calls[0].request.state).toBe("HEADWORD\nword: xiii\nrecorded parts of speech: none recorded");
    expect(result.verdict).toBe("advance");
  });
});

describe("configuration identity", () => {
  it("names the combiner in the result's config id, so results from different combiners never compare as equal", async () => {
    const jev = fakeJev({ 1: obviousness(0.1), 2: obviousness(0.1), 3: obviousness(0.1) });
    const subject = { headword: "parlance", partsOfSpeech: ["n"] };

    const a = await judgeUsefulness(subject, loadCombiner(obviousnessOnlyArtifact()), jev.client);
    const b = await judgeUsefulness(subject, loadCombiner({ ...obviousnessOnlyArtifact(), id: "refit" }), jev.client);
    const again = await judgeUsefulness(subject, loadCombiner(obviousnessOnlyArtifact()), jev.client);

    expect(a.configId).toMatch(/^[0-9a-f]{64}$/);
    expect(a.configId).not.toBe(b.configId);
    expect(a.configId).toBe(again.configId);
  });
});

describe("loadCombiner", () => {
  it("rejects a combiner fitted on a different question set", () => {
    const artifact = obviousnessOnlyArtifact();
    artifact.input_feature_names = [...artifact.input_feature_names, "school.high_school"].sort();

    expect(() => loadCombiner(artifact)).toThrow(/question/i);
  });

  it("rejects a combiner whose weights do not line up with its features", () => {
    expect(() => loadCombiner({ ...obviousnessOnlyArtifact(), coefficients: [-10, 2] })).toThrow();
  });
});
