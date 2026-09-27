// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replayJev, type JevRequest, type Questions } from "./jev.js";

const questions: Questions = {
  field_association: {
    type: "noul",
    instructions: "Is this word strongly associated with a particular field?",
    criteria: { true: "Strong association", false: "No strong association" }
  },
  precision: {
    type: "score",
    instructions: "How much does this word express a distinction?",
    criteria: ["None", "Tone", "Clear", "Clear with connotation"]
  }
};

const request: JevRequest = {
  model: "typesafe/jev-1.13",
  state: "HEADWORD\nword: parlance\nrecorded parts of speech: n",
  questions
};

const fieldAnswer = { type: "noul", noul: 0.2 };
const precisionAnswer = {
  type: "score",
  score: 2.08,
  probabilities: { "0": 0.02, "1": 0.12, "2": 0.62, "3": 0.24 },
  confidence: 0.62
};

function answersFile(records: unknown[], fileQuestions: Questions = questions): string {
  const dir = mkdtempSync(join(tmpdir(), "jev-replay-"));
  const path = join(dir, "answers.json");
  writeFileSync(path, JSON.stringify({ schema: "wordwell-jev-answers/v1", questions: fileQuestions, answers: records }));
  return path;
}

function record(question: string, trial: number, answer: unknown) {
  return { model: request.model, state: request.state, question, trial, answer };
}

describe("replayJev", () => {
  it("returns the saved answers for every question in the request", async () => {
    const path = answersFile([
      record("field_association", 1, fieldAnswer),
      record("precision", 1, precisionAnswer)
    ]);

    const answers = await replayJev([path]).ask(request, 1);

    expect(answers).toEqual({ field_association: fieldAnswer, precision: precisionAnswer });
  });

  it("refuses a request with any answer missing instead of calling Jev", async () => {
    const path = answersFile([record("field_association", 1, fieldAnswer)]);

    await expect(replayJev([path]).ask(request, 1)).rejects.toMatchObject({ kind: "not_saved" });
  });

  it("does not reuse answers given to different question text", async () => {
    const edited = { ...questions, precision: { ...questions.precision, instructions: "Reworded." } as Questions[string] };
    const path = answersFile([
      record("field_association", 1, fieldAnswer),
      record("precision", 1, precisionAnswer)
    ], edited);

    await expect(replayJev([path]).ask(request, 1)).rejects.toMatchObject({ kind: "not_saved" });
  });

  it.each([
    ["noul outside 0..1", "field_association", { type: "noul", noul: 1.2 }],
    ["answer type differs from the question", "field_association", { type: "score", score: 1, probabilities: { "0": 0, "1": 1 }, confidence: 1 }],
    ["probabilities sum to 0.9", "precision", { ...precisionAnswer, probabilities: { "0": 0.02, "1": 0.12, "2": 0.52, "3": 0.24 } }],
    ["a score level is missing", "precision", { ...precisionAnswer, probabilities: { "0": 0.14, "2": 0.62, "3": 0.24 } }],
    ["score disagrees with its distribution", "precision", { ...precisionAnswer, score: 2.5 }],
    ["score above the top level", "precision", { ...precisionAnswer, score: 3.2 }],
    ["legend differs from the rubric", "precision", { ...precisionAnswer, legend: { "0": "Changed", "1": "Tone", "2": "Clear", "3": "Clear with connotation" } }]
  ])("rejects a saved answer when %s", async (_case, name, bad) => {
    const good = { field_association: fieldAnswer, precision: precisionAnswer } as Record<string, unknown>;
    const path = answersFile(Object.entries({ ...good, [name]: bad }).map(([q, a]) => record(q, 1, a)));

    await expect(replayJev([path]).ask(request, 1)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("rejects a choice that is not the most probable option", async () => {
    const choiceQuestions: Questions = {
      concept: {
        type: "choice",
        instructions: "What does this word principally let an adult name?",
        criteria: { reusable_concept: "Reusable", factual_label: "Factual" }
      }
    };
    const bad = { type: "choice", choice: "reusable_concept", probabilities: { reusable_concept: 0.23, factual_label: 0.77 }, confidence: 0.77 };
    const path = answersFile([record("concept", 1, bad)], choiceQuestions);

    await expect(replayJev([path]).ask({ ...request, questions: choiceQuestions }, 1)).rejects.toMatchObject({ kind: "invalid" });
  });
});
