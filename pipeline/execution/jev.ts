// Jev client. Every adapter returns only answers that passed validation, so
// callers never see a raw reply.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const noulQuestion = z.strictObject({
  type: z.literal("noul"),
  instructions: z.string(),
  criteria: z.strictObject({ true: z.string(), false: z.string() })
});
const scoreQuestion = z.strictObject({
  type: z.literal("score"),
  instructions: z.string(),
  criteria: z.array(z.string()).min(2)
});
const choiceQuestion = z.strictObject({
  type: z.literal("choice"),
  instructions: z.string(),
  criteria: z.record(z.string(), z.string())
});
const question = z.discriminatedUnion("type", [noulQuestion, scoreQuestion, choiceQuestion]);
const questions = z.record(z.string(), question);

export type Question = z.infer<typeof question>;
export type Questions = z.infer<typeof questions>;

export type JevRequest = { model: "typesafe/jev-1.13"; state: string; questions: Questions };

export type NoulAnswer = { type: "noul"; noul: number };
export type ScoreAnswer = { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };
export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type Answer = NoulAnswer | ScoreAnswer | ChoiceAnswer;
export type JevAnswers = Record<string, Answer>;

export type JevErrorKind = "not_saved" | "invalid" | "http" | "uncertain" | "cap_reached";

// Every Jev failure stops the run. Nothing retries or substitutes an answer.
export class JevError extends Error {
  constructor(readonly kind: JevErrorKind, message: string) {
    super(message);
    this.name = "JevError";
  }
}

export interface JevClient {
  ask(request: JevRequest, trial: number): Promise<JevAnswers>;
}

export const V1_ROUTE = "https://openrouter.ai/api/v1/systemone";
export const PINNED_MODEL_VERSION = "typesafe/jev-1.13-20260917";

const reply = z.object({
  model: z.string(),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({ cost: z.number().nonnegative().optional() }).optional()
});

type Fetch = typeof globalThis.fetch;

// Live Jev through OpenRouter's v1 route. Every attempt, valid or not, is
// saved privately before and after the call. No retries: any failure stops
// the run, and a lost connection is "uncertain" because Jev may have charged.
export function httpJev({ apiKey, maxRequests, attemptsDir, fetch = globalThis.fetch, timeoutMs = 60_000 }: {
  apiKey: string;
  maxRequests: number;
  attemptsDir: string;
  fetch?: Fetch;
  timeoutMs?: number;
}): JevClient {
  let sent = 0;
  mkdirSync(attemptsDir, { recursive: true, mode: 0o700 });
  return {
    async ask(request, trial) {
      if (sent >= maxRequests) throw new JevError("cap_reached", `Request cap of ${maxRequests} reached`);
      sent += 1;
      const attempt: Record<string, unknown> = { id: randomUUID(), at: new Date().toISOString(), trial, request, status: "in_flight" };
      const path = join(attemptsDir, `${attempt.id}.json`);
      const save = () => writeFileSync(path, JSON.stringify(attempt, null, 1), { mode: 0o600 });
      save();
      const started = Date.now();
      const finish = (status: string, fields: Record<string, unknown> = {}) => {
        Object.assign(attempt, { status, elapsedMs: Date.now() - started }, fields);
        save();
      };
      let response: Response;
      let raw: string;
      try {
        response = await fetch(V1_ROUTE, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-OpenRouter-Cache": "false" },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(timeoutMs)
        });
        raw = await response.text();
      } catch (e) {
        finish("uncertain", { error: String(e) });
        throw new JevError("uncertain", `No complete reply: ${String(e)}`);
      }
      if (!response.ok) {
        finish("http", { httpStatus: response.status, raw });
        throw new JevError("http", `HTTP ${response.status}`);
      }
      try {
        const data = reply.parse(JSON.parse(raw));
        const costUsd = data.usage?.cost ?? null;
        Object.assign(attempt, { raw, costUsd });
        if (data.model !== PINNED_MODEL_VERSION) throw new JevError("invalid", `Unexpected model ${data.model}`);
        const expected = Object.keys(request.questions).sort();
        const got = Object.keys(data.answers).sort();
        if (!isDeepStrictEqual(expected, got)) throw new JevError("invalid", "Answers do not match the questions asked");
        const answers: JevAnswers = {};
        for (const [name, definition] of Object.entries(request.questions)) {
          answers[name] = validateAnswer(name, definition, data.answers[name]);
        }
        finish("valid");
        return answers;
      } catch (e) {
        finish("invalid", { raw, error: String(e) });
        throw e instanceof JevError ? e : new JevError("invalid", `Unreadable reply: ${String(e)}`);
      }
    }
  };
}

const answersFile = z.object({
  schema: z.literal("wordwell-jev-answers/v1"),
  questions,
  answers: z.array(z.object({
    model: z.string(),
    state: z.string(),
    question: z.string(),
    trial: z.number().int().positive(),
    answer: z.unknown()
  }))
});

type SavedFile = z.infer<typeof answersFile>;

// Replays answers saved by earlier runs. A question matches only if its saved
// definition is identical to the requested one, so edited question text never
// reuses an old answer.
export function replayJev(sources: string[]): JevClient {
  const files: SavedFile[] = sources.map((path) => answersFile.parse(JSON.parse(readFileSync(path, "utf8"))));
  return {
    async ask(request, trial) {
      const result: JevAnswers = {};
      for (const [name, definition] of Object.entries(request.questions)) {
        const saved = find(files, request, name, definition, trial);
        if (saved === undefined) throw new JevError("not_saved", `No saved answer for ${name}, trial ${trial}`);
        result[name] = validateAnswer(name, definition, saved);
      }
      return result;
    }
  };
}

function find(files: SavedFile[], request: JevRequest, name: string, definition: Question, trial: number): unknown {
  for (const file of files) {
    if (!isDeepStrictEqual(file.questions[name], definition)) continue;
    const saved = file.answers.find((a) =>
      a.model === request.model && a.state === request.state && a.question === name && a.trial === trial);
    if (saved) return saved.answer;
  }
  return undefined;
}

const probability = z.number().min(0).max(1);
const noulAnswer = z.object({ type: z.literal("noul"), noul: probability });
const distributionAnswer = z.object({
  probabilities: z.record(z.string(), probability),
  confidence: probability
});
const scoreAnswer = distributionAnswer.extend({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()).nullish()
});
const choiceAnswer = distributionAnswer.extend({ type: z.literal("choice"), choice: z.string() });

// Same acceptance rules as the lab's validate_response, so replayed and live
// answers pass the same checks.
export function validateAnswer(name: string, definition: Question, raw: unknown): Answer {
  const fail = (reason: string): never => {
    throw new JevError("invalid", `${name}: ${reason}`);
  };
  if (definition.type === "noul") {
    const parsed = noulAnswer.safeParse(raw);
    if (!parsed.success) fail("invalid Noul answer");
    return { type: "noul", noul: parsed.data!.noul };
  }
  const keys = definition.type === "choice"
    ? Object.keys(definition.criteria)
    : definition.criteria.map((_, i) => String(i));
  const checkDistribution = (probabilities: Record<string, number>) => {
    const got = Object.keys(probabilities);
    if (got.length !== keys.length || !keys.every((k) => k in probabilities)) fail("distribution keys differ from the rubric");
    const total = Object.values(probabilities).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 0.02) fail("probabilities do not sum to 1");
  };
  if (definition.type === "choice") {
    const parsed = choiceAnswer.safeParse(raw);
    if (!parsed.success) fail("invalid choice answer");
    const { choice, probabilities, confidence } = parsed.data!;
    checkDistribution(probabilities);
    if (!keys.includes(choice) || probabilities[choice] + 1e-6 < Math.max(...Object.values(probabilities))) {
      fail("choice is not the most probable option");
    }
    return { type: "choice", choice, probabilities, confidence };
  }
  const parsed = scoreAnswer.safeParse(raw);
  if (!parsed.success) fail("invalid score answer");
  const { score, probabilities, confidence, legend } = parsed.data!;
  checkDistribution(probabilities);
  if (score < 0 || score > definition.criteria.length - 1) fail("score outside the rubric");
  const expected = Object.entries(probabilities).reduce((sum, [k, p]) => sum + Number(k) * p, 0);
  if (Math.abs(score - expected) > 0.06) fail("score disagrees with its distribution");
  if (legend != null && !isDeepStrictEqual(legend, Object.fromEntries(definition.criteria.map((c, i) => [String(i), c])))) {
    fail("legend differs from the rubric");
  }
  return { type: "score", score, probabilities, confidence };
}
