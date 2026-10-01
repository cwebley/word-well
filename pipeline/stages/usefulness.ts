// Usefulness gate: headword and recorded parts of speech in, advance or
// exclude out. Jev answers the questions; the combiner, never the model,
// turns averaged answers into the verdict.
import { createHash } from "node:crypto";
import questionsJson from "./usefulness-questions.json" with { type: "json" };
import { z } from "zod";
import type { JevAnswers, JevClient, JevRequest, Questions } from "../execution/jev.js";

export const QUESTIONS = questionsJson as Questions;
export const MODEL = "typesafe/jev-1.13";
export const TRIALS = 3;

export type Subject = { headword: string; partsOfSpeech: string[] };
export type Verdict = "advance" | "exclude";

// Feature names follow the lab's fit artifacts: usefulness.<question> for
// Noul and score answers, usefulness.<question>.<option> for choice answers.
export const FEATURE_NAMES: string[] = Object.entries(QUESTIONS).flatMap(([name, q]) =>
  q.type === "choice" ? Object.keys(q.criteria).map((k) => `usefulness.${name}.${k}`) : [`usefulness.${name}`]
).sort();

const combinerArtifact = z.object({
  id: z.string(),
  input_feature_names: z.array(z.string()),
  feature_names: z.array(z.string()).min(1),
  mean: z.array(z.number()),
  scale: z.array(z.number().positive()),
  coefficients: z.array(z.number()),
  intercept: z.number(),
  threshold: z.number().gt(0).lt(1)
}).refine((a) => [a.mean, a.scale, a.coefficients].every((v) => v.length === a.feature_names.length),
  "mean, scale and coefficients must each have one entry per feature");

export type Combiner = z.infer<typeof combinerArtifact>;

export type UsefulnessResult = {
  verdict: Verdict;
  keepScore: number;
  trials: { answers: JevAnswers; keepScore: number; verdict: Verdict }[];
  configId: string;
};

// Identifies what produced a verdict: model pin, exact questions and combiner.
export function configId(combiner: Combiner): string {
  return createHash("sha256").update(JSON.stringify({ model: MODEL, questions: QUESTIONS, trials: TRIALS, combiner: combiner.id })).digest("hex");
}

// Reads a fit artifact written by tools/usefulness-fit. It must have been fitted
// on exactly the features the current questions produce.
export function loadCombiner(artifact: unknown): Combiner {
  const combiner = combinerArtifact.parse(artifact);
  const inputs = [...combiner.input_feature_names].sort();
  if (inputs.length !== FEATURE_NAMES.length || inputs.some((n, i) => n !== FEATURE_NAMES[i])) {
    throw new Error(`Combiner ${combiner.id} was fitted on a different question set`);
  }
  if (combiner.feature_names.some((n) => !inputs.includes(n))) {
    throw new Error(`Combiner ${combiner.id} weights a feature it was not given`);
  }
  return combiner;
}

function features(trials: JevAnswers[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const answers of trials) {
    for (const [name, answer] of Object.entries(answers)) {
      const values: [string, number][] = answer.type === "noul" ? [[`usefulness.${name}`, answer.noul]]
        : answer.type === "score" ? [[`usefulness.${name}`, answer.score]]
        : Object.entries(answer.probabilities).map(([k, p]) => [`usefulness.${name}.${k}`, p]);
      for (const [key, value] of values) sums[key] = (sums[key] ?? 0) + value;
    }
  }
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v / trials.length]));
}

function keepScore(combiner: Combiner, values: Record<string, number>): number {
  const logit = combiner.feature_names.reduce((sum, name, i) =>
    sum + ((values[name] - combiner.mean[i]) / combiner.scale[i]) * combiner.coefficients[i], combiner.intercept);
  return logit >= 0 ? 1 / (1 + Math.exp(-logit)) : Math.exp(logit) / (1 + Math.exp(logit));
}

const verdictFor = (combiner: Combiner, score: number): Verdict => score >= combiner.threshold ? "advance" : "exclude";

export function renderState(subject: Subject): string {
  const pos = subject.partsOfSpeech.join(", ") || "none recorded";
  return `HEADWORD\nword: ${subject.headword}\nrecorded parts of speech: ${pos}`;
}

export async function judgeUsefulness(subject: Subject, combiner: Combiner, jev: JevClient): Promise<UsefulnessResult> {
  const request: JevRequest = { model: MODEL, state: renderState(subject), questions: QUESTIONS };
  const trials = await Promise.all(Array.from({ length: TRIALS }, (_, i) => jev.ask(request, i + 1)));
  const score = keepScore(combiner, features(trials));
  return {
    verdict: verdictFor(combiner, score),
    keepScore: score,
    trials: trials.map((answers) => {
      const alone = keepScore(combiner, features([answers]));
      return { answers, keepScore: alone, verdict: verdictFor(combiner, alone) };
    }),
    configId: configId(combiner)
  };
}
