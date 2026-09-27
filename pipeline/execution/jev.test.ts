// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { httpJev, replayJev, type JevRequest, type Questions } from "./jev.js";

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

describe("httpJev", () => {
  const reply = (overrides: Record<string, unknown> = {}) => ({
    id: "gen-dec-1",
    model: "typesafe/jev-1.13-20260917",
    provider: "TypeSafe",
    answers: { field_association: fieldAnswer, precision: precisionAnswer },
    usage: { input_tokens: 620, output_tokens: 20, cost: 0.000026 },
    ...overrides
  });

  function fakeFetch(respond: () => Response | Promise<Response>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return respond();
    };
    return { fetch: fetch as typeof globalThis.fetch, calls };
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const attemptsDir = () => mkdtempSync(join(tmpdir(), "jev-attempts-"));

  it("posts the request to the v1 System One route and returns validated answers", async () => {
    const f = fakeFetch(() => json(reply()));
    const jev = httpJev({ apiKey: "key", maxRequests: 5, attemptsDir: attemptsDir(), fetch: f.fetch });

    const answers = await jev.ask(request, 2);

    expect(answers).toEqual({ field_association: fieldAnswer, precision: precisionAnswer });
    expect(f.calls[0].url).toBe("https://openrouter.ai/api/v1/systemone");
    expect(f.calls[0].init.method).toBe("POST");
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ model: "typesafe/jev-1.13", state: request.state, questions });
  });

  it.each([
    ["an unpinned model version", reply({ model: "typesafe/jev-1.14-20261001" })],
    ["a missing answer", reply({ answers: { field_association: fieldAnswer } })],
    ["an extra answer", reply({ answers: { field_association: fieldAnswer, precision: precisionAnswer, other: fieldAnswer } })],
    ["an invalid answer", reply({ answers: { field_association: { type: "noul", noul: 2 }, precision: precisionAnswer } })]
  ])("rejects a reply with %s", async (_case, body) => {
    const jev = httpJev({ apiKey: "key", maxRequests: 5, attemptsDir: attemptsDir(), fetch: fakeFetch(() => json(body)).fetch });

    await expect(jev.ask(request, 1)).rejects.toMatchObject({ kind: "invalid" });
  });

  it("reports an HTTP failure and keeps the raw reply in the attempt record", async () => {
    const dir = attemptsDir();
    const jev = httpJev({ apiKey: "key", maxRequests: 5, attemptsDir: dir, fetch: fakeFetch(() => new Response("upstream down", { status: 502 })).fetch });

    await expect(jev.ask(request, 1)).rejects.toMatchObject({ kind: "http" });
    const [attempt] = readdirSync(dir).map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
    expect(attempt).toMatchObject({ status: "http", httpStatus: 502, raw: "upstream down", trial: 1 });
  });

  it("treats a lost connection as uncertain, since Jev may have answered and charged", async () => {
    const jev = httpJev({ apiKey: "key", maxRequests: 5, attemptsDir: attemptsDir(), fetch: fakeFetch(() => { throw new TypeError("fetch failed"); }).fetch });

    await expect(jev.ask(request, 1)).rejects.toMatchObject({ kind: "uncertain" });
  });

  it("refuses to send more requests than its cap", async () => {
    const f = fakeFetch(() => json(reply()));
    const jev = httpJev({ apiKey: "key", maxRequests: 1, attemptsDir: attemptsDir(), fetch: f.fetch });

    await jev.ask(request, 1);

    await expect(jev.ask(request, 2)).rejects.toMatchObject({ kind: "cap_reached" });
    expect(f.calls).toHaveLength(1);
  });

  it("records each valid reply's cost", async () => {
    const dir = attemptsDir();
    const jev = httpJev({ apiKey: "key", maxRequests: 5, attemptsDir: dir, fetch: fakeFetch(() => json(reply())).fetch });

    await jev.ask(request, 1);

    const [attempt] = readdirSync(dir).map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
    expect(attempt).toMatchObject({ status: "valid", costUsd: 0.000026, request: { state: request.state } });
  });
});
