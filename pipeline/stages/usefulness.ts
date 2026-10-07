// Usefulness gate: headword and recorded parts of speech in, advance or
// exclude out. Jev answers the questions; the combiner, never the model,
// turns averaged answers into the verdict.
import { createHash } from "node:crypto";
import questionsJson from "./usefulness-questions.json" with { type: "json" };
import { z } from "zod";
import type { JevAnswers, JevClient, JevRequest, Questions } from "../execution/jev.js";
import { PINNED_MODEL_VERSION, validateAnswer } from "../execution/jev.js";
import { digest, PrivateError } from "../storage/crypto.js";
import type { StageDefinition } from "../execution/stage.js";

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

export function features(trials: JevAnswers[]): Record<string, number> {
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
  return combineTrials(trials, combiner);
}

export function combineTrials(trials: JevAnswers[], combiner: Combiner): UsefulnessResult {
  if (trials.length !== TRIALS) throw new PrivateError("usefulness_trials_incomplete");
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

export const usefulnessInputSchema = z.object({ headword: z.string().min(1).max(200), partsOfSpeech: z.array(z.string().min(1)) }).strict();
export const usefulnessAnswersSchema = z.record(z.string(), z.unknown()).transform((value, ctx): JevAnswers => {
  try {
    const names = Object.keys(value).sort(), expected = Object.keys(QUESTIONS).sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error();
    return Object.fromEntries(Object.entries(QUESTIONS).map(([name, question]) => [name, validateAnswer(name, question, value[name])]));
  } catch {
    ctx.addIssue({ code: "custom", message: "invalid measured answers" });
    return z.NEVER;
  }
});
export const usefulnessTrialSchema = z.object({ answers: usefulnessAnswersSchema, keepScore: z.number().min(0).max(1), verdict: z.enum(["advance", "exclude"]) }).strict();
export const usefulnessConfigurationSchema = z.object({ schema: z.literal("wordwell-usefulness-configuration-v1"), stage: z.literal("usefulness"),
  route: z.literal("openrouter-systemone-v1"), requestedModel: z.literal(MODEL), pinnedModel: z.literal(PINNED_MODEL_VERSION),
  questions: z.unknown().refine(value => JSON.stringify(value) === JSON.stringify(QUESTIONS), "measured questions required"),
  trials: z.literal(3), combiner: combinerArtifact }).strict();
export type UsefulnessConfiguration = z.infer<typeof usefulnessConfigurationSchema>;
export function usefulnessConfiguration(combiner: Combiner): UsefulnessConfiguration {
  return usefulnessConfigurationSchema.parse({ schema: "wordwell-usefulness-configuration-v1", stage: "usefulness", route: "openrouter-systemone-v1",
    requestedModel: MODEL, pinnedModel: PINNED_MODEL_VERSION, questions: QUESTIONS, trials: TRIALS, combiner: loadCombiner(combiner) });
}
export function createUsefulnessStage(material: UsefulnessConfiguration): StageDefinition<Subject, z.infer<typeof usefulnessTrialSchema>> {
  const configuration = usefulnessConfigurationSchema.parse(material), combiner = loadCombiner(configuration.combiner);
  return { name: "usefulness", fingerprint: digest(JSON.stringify(configuration)), configuration,
    inputSchema: usefulnessInputSchema, resultSchema: usefulnessTrialSchema,
    render(input) {
      const parsed = usefulnessInputSchema.safeParse(input);
      if (!parsed.success) throw new PrivateError("stage_input_invalid");
      return { model: MODEL, state: renderState(parsed.data), questions: QUESTIONS };
    },
    validate(raw) {
      let json: unknown;
      try { json = JSON.parse(raw); } catch { return { ok: false, code: "malformed_reply" }; }
      const reply = z.object({ model: z.string(), answers: z.unknown() }).safeParse(json);
      if (!reply.success) return { ok: false, code: "malformed_reply" };
      if (reply.data.model !== PINNED_MODEL_VERSION) return { ok: false, code: "wrong_model" };
      const parsed = usefulnessAnswersSchema.safeParse(reply.data.answers);
      if (!parsed.success) return { ok: false, code: "answers_invalid" };
      const score = keepScore(combiner, features([parsed.data]));
      return { ok: true, result: { answers: parsed.data, keepScore: score, verdict: verdictFor(combiner, score) } };
    }
  };
}
