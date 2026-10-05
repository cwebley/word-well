// Appropriateness gate: the exact headword in, accept or reject out.
// Approved on #12. Jev answers one choice question, plus an optional narrow
// slur-sense question (owner-approved on #15); this module, never the model,
// turns the probabilities into a disposition.
import { z } from "zod";
import { digest, PrivateError } from "../storage/crypto.js";
import type { StageDefinition, Validation } from "../execution/stage.js";

const choiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z.object({ clear: z.string().min(1), blocked: z.string().min(1) }).strict()
}).strict();
const noulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
  criteria: z.object({ true: z.string().min(1), false: z.string().min(1) }).strict()
}).strict();

export const configurationSchema = z.object({
  schema: z.literal("wordwell-appropriateness-configuration-v1"),
  stage: z.literal("appropriateness"),
  route: z.literal("openrouter-systemone-v1"),
  requestedModel: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+$/),
  pinnedModel: z.string().regex(/^[a-z0-9-]+\/[a-z0-9.-]+$/),
  questionId: z.string().regex(/^[a-z_]{1,64}$/),
  question: choiceQuestionSchema,
  // Absent in single-question configurations, so their fingerprints are unchanged.
  slurQuestion: z.object({ id: z.string().regex(/^[a-z_]{1,64}$/), question: noulQuestionSchema }).strict().optional(),
  vulgarQuestion: z.object({ id: z.string().regex(/^[a-z_]{1,64}$/), question: noulQuestionSchema }).strict().optional(),
  policy: z.object({
    blockedThreshold: z.literal(0.5),
    // Per-question thresholds for the narrow questions; absent means 0.50.
    slurThreshold: z.number().min(0.05).max(0.95).optional(),
    vulgarThreshold: z.number().min(0.05).max(0.95).optional(),
    trials: z.literal(3),
    aggregate: z.literal("mean-before-threshold")
  }).strict()
}).strict();
export type AppropriatenessConfiguration = z.infer<typeof configurationSchema>;

// Configurations form a numbered lineage. Names are labels only: the
// fingerprint covers the material, so renaming never changes saved evidence.

// v2: the owner's 2026-10-04 wording, every sense considered, slur senses named.
const V2: AppropriatenessConfiguration = {
  schema: "wordwell-appropriateness-configuration-v1",
  stage: "appropriateness",
  route: "openrouter-systemone-v1",
  requestedModel: "typesafe/jev-1.13",
  pinnedModel: "typesafe/jev-1.13-20260917",
  questionId: "appropriateness",
  question: {
    type: "choice",
    instructions:
      "Assess whether this headword is appropriate for WordWell, a General American English vocabulary app for adults.\n\n" +
      "Consider every established sense of the headword, not only its most common one. Choose blocked if any sense is a slur or derogatory term for people based on race, ethnicity, nationality, religion, sex, sexual orientation, gender identity, or disability, even when the headword's main sense is harmless.\n\n" +
      "Also choose blocked if the headword has other offensive or derogatory usage, sexually explicit usage, profanity, or vulgar bodily usage, including a plausible connotation in any of those categories.\n\n" +
      "Neutral medical or anatomical subject matter alone is allowed. Choose clear when no slur sense, prohibited usage, or plausible prohibited connotation is identified.",
    criteria: {
      clear: "No slur sense, prohibited usage, or plausible prohibited connotation identified.",
      blocked: "A slur sense, other prohibited usage, or a plausible prohibited connotation identified."
    }
  },
  policy: { blockedThreshold: 0.5, trials: 3, aggregate: "mean-before-threshold" }
};

// v1: the original #12 wording.
const V1: AppropriatenessConfiguration = {
  ...V2,
  question: {
    type: "choice",
    instructions:
      "Assess whether this headword is appropriate for WordWell, a General American English vocabulary app for adults.\n\n" +
      "Choose blocked if the headword has offensive or derogatory usage, sexually explicit usage, profanity, or vulgar bodily usage, including a plausible connotation in any of those categories. Assess the headword as a whole.\n\n" +
      "Neutral medical or anatomical subject matter alone is allowed. Choose clear when no prohibited usage or plausible prohibited connotation is identified.",
    criteria: {
      clear: "No prohibited usage or plausible prohibited connotation identified.",
      blocked: "Prohibited usage or a plausible prohibited connotation identified."
    }
  }
};

export const SLUR_QUESTION: NonNullable<AppropriatenessConfiguration["slurQuestion"]> = {
  id: "slur_sense",
  question: {
    type: "noul",
    instructions:
      "Does any established sense of this headword function as a slur or derogatory term for people based on race, ethnicity, nationality, religion, sex, sexual orientation, gender identity, or disability? " +
      "Consider every established sense, including secondary, dated, regional, and slang senses, even when the headword's main sense is harmless.",
    criteria: {
      true: "At least one established sense is a slur or derogatory term for a group of people.",
      false: "No established sense is a slur or derogatory term for a group of people."
    }
  }
};

export const VULGAR_QUESTION: NonNullable<AppropriatenessConfiguration["vulgarQuestion"]> = {
  id: "vulgar_sense",
  question: {
    type: "noul",
    instructions:
      "Does any established sense of this headword have a sexual, vulgar bodily, or profane slang meaning? " +
      "Consider every established sense, including secondary, dated, regional, and slang senses, even when the headword's main sense is harmless.",
    criteria: {
      true: "At least one established sense has a sexual, vulgar bodily, or profane slang meaning.",
      false: "No established sense has a sexual, vulgar bodily, or profane slang meaning."
    }
  }
};

// v3: v2 plus the slur-sense question.
const V3: AppropriatenessConfiguration = { ...V2, slurQuestion: SLUR_QUESTION };

// v4: v3 with genital and sexual-act terms excluded from the anatomical
// exemption and a slur threshold of 0.40. Owner chose it as the default on
// 2026-10-05 after v6 development and the public-word audit (#15).
const V4_MAIN_QUESTION = {
  ...V2.question,
  instructions: V2.question.instructions.replace(
    "Neutral medical or anatomical subject matter alone is allowed.",
    "Neutral medical or anatomical subject matter is allowed, except terms for genitals or sexual acts.")
};
// Tried and not adopted: v4 plus the vulgar-sense question. It caught no
// blocked word on its own and added false blocks to everyday words.
const V4_VULGAR_CHECK: AppropriatenessConfiguration = {
  ...V3, question: V4_MAIN_QUESTION, vulgarQuestion: VULGAR_QUESTION,
  policy: { ...V3.policy, slurThreshold: 0.4, vulgarThreshold: 0.5 }
};
const { vulgarQuestion: _vulgar, ...V4_BASE } = V4_VULGAR_CHECK;
const V4: AppropriatenessConfiguration = { ...V4_BASE, policy: { ...V3.policy, slurThreshold: 0.4 } };

// Tried and not adopted: v3 plus a rule against judging spelling lookalikes.
const V3_LOOKALIKE: AppropriatenessConfiguration = {
  ...V3,
  question: {
    ...V2.question,
    instructions: V2.question.instructions.replace(
      "\n\nNeutral medical or anatomical subject matter alone is allowed.",
      "\n\nJudge the headword's established meanings, not the spelling or sound of its parts. A word that merely contains a vulgar-looking string is clear.\n\nNeutral medical or anatomical subject matter alone is allowed.")
  }
};

// The default. Changing it is the owner's recorded decision.
export const APPROPRIATENESS_CONFIGURATION: AppropriatenessConfiguration = V4;

// Named configurations evaluated on the same frozen inputs (`--configuration`).
export const CONFIGURATIONS: Record<string, AppropriatenessConfiguration> = {
  "v1": V1,
  "v2": V2,
  "v3": V3,
  "v4": V4,
  "v1-slur-check": { ...V1, slurQuestion: SLUR_QUESTION },
  "v3-lookalike": V3_LOOKALIKE,
  "v4-vulgar-check": V4_VULGAR_CHECK
};

export const inputSchema = z.object({ headword: z.string().min(1).max(200) }).strict();
export type AppropriatenessInput = z.infer<typeof inputSchema>;

export type Disposition = "accept" | "reject";
const probability = z.number().min(0).max(1);
export const resultSchema = z.object({
  choice: z.enum(["clear", "blocked"]),
  probabilities: z.object({ clear: probability, blocked: probability }).strict(),
  confidence: probability,
  blockedProbability: probability,
  // Present only for configurations with the slur-sense question.
  slurProbability: probability.nullable().optional(),
  vulgarProbability: probability.nullable().optional(),
  finding: z.enum(["clear", "blocked"]),
  disposition: z.enum(["accept", "reject"])
}).strict();
export type AppropriatenessResult = z.infer<typeof resultSchema>;

const THRESHOLD = 0.5;
// Intentional trials per case; the policy schema pins the same value.
export const TRIALS = 3;
// Jev reports two-decimal probabilities.
const SUM_TOLERANCE = 0.011;
const ROUNDING_STEP = 0.01 + 1e-9;

export type Signals = { blocked: number; slur: number | null; vulgar?: number | null };
export type Thresholds = { blocked: number; slur: number; vulgar: number };
const DEFAULT_THRESHOLDS: Thresholds = { blocked: THRESHOLD, slur: THRESHOLD, vulgar: THRESHOLD };
export const thresholdsFor = (configuration: AppropriatenessConfiguration): Thresholds => ({
  blocked: configuration.policy.blockedThreshold,
  slur: configuration.policy.slurThreshold ?? THRESHOLD,
  vulgar: configuration.policy.vulgarThreshold ?? THRESHOLD
});

// Rejects when any asked question reaches its threshold, including exact ties.
export function dispositionFor(signals: Signals | number, thresholds: Thresholds = DEFAULT_THRESHOLDS): Disposition {
  const s = typeof signals === "number" ? { blocked: signals, slur: null } : signals;
  return s.blocked >= thresholds.blocked || (s.slur !== null && s.slur >= thresholds.slur) ||
    (s.vulgar != null && s.vulgar >= thresholds.vulgar) ? "reject" : "accept";
}

// Production verdict: each question's mean over three valid trials,
// thresholded unrounded. Any missing trial means no verdict.
export function averageDecision(trials: (Signals | null)[], thresholds: Thresholds = DEFAULT_THRESHOLDS):
    { blockedProbability: number; slurProbability: number | null; vulgarProbability: number | null; disposition: Disposition } | null {
  if (trials.length !== TRIALS || trials.some(trial => trial === null)) return null;
  const valid = trials as Signals[];
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / TRIALS;
  const blocked = mean(valid.map(trial => trial.blocked));
  const slur = valid.every(trial => trial.slur !== null) ? mean(valid.map(trial => trial.slur!)) : null;
  const vulgar = valid.every(trial => trial.vulgar != null) ? mean(valid.map(trial => trial.vulgar!)) : null;
  return { blockedProbability: blocked, slurProbability: slur, vulgarProbability: vulgar,
    disposition: dispositionFor({ blocked, slur, vulgar }, thresholds) };
}

const replySchema = z.object({ model: z.string(), answers: z.record(z.string(), z.unknown()) }).passthrough();
const noulAnswerSchema = z.object({ type: z.literal("noul"), noul: z.number() }).passthrough();
const answerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number()
}).passthrough();

export function createAppropriatenessStage(material: AppropriatenessConfiguration): StageDefinition<AppropriatenessInput, AppropriatenessResult> {
  const configuration = configurationSchema.parse(material);
  const fingerprint = digest(JSON.stringify(configuration));
  const fail = (code: string): Validation<AppropriatenessResult> => ({ ok: false, code });
  return {
    name: "appropriateness",
    fingerprint,
    configuration,
    inputSchema,
    resultSchema,
    render(input) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new PrivateError("stage_input_invalid");
      return {
        model: configuration.requestedModel,
        state: parsed.data.headword,
        questions: {
          [configuration.questionId]: configuration.question,
          ...(configuration.slurQuestion ? { [configuration.slurQuestion.id]: configuration.slurQuestion.question } : {}),
          ...(configuration.vulgarQuestion ? { [configuration.vulgarQuestion.id]: configuration.vulgarQuestion.question } : {})
        }
      };
    },
    validate(raw) {
      let json: unknown;
      try { json = JSON.parse(raw); } catch { return fail("malformed_reply"); }
      if (json && typeof json === "object" && "error" in json) return fail("provider_error");
      const reply = replySchema.safeParse(json);
      if (!reply.success) return fail("malformed_reply");
      if (reply.data.model !== configuration.pinnedModel) return fail("wrong_model");
      const names = Object.keys(reply.data.answers).sort();
      const expected = [configuration.questionId, ...(configuration.slurQuestion ? [configuration.slurQuestion.id] : []),
        ...(configuration.vulgarQuestion ? [configuration.vulgarQuestion.id] : [])].sort();
      if (names.length !== expected.length || names.some((name, i) => name !== expected[i])) return fail("answers_mismatch");
      const answer = answerSchema.safeParse(reply.data.answers[configuration.questionId]);
      if (!answer.success) return fail("malformed_reply");
      const { choice, probabilities, confidence } = answer.data;
      if (choice !== "clear" && choice !== "blocked") return fail("choice_not_allowed");
      const keys = Object.keys(probabilities).sort();
      if (keys.length !== 2 || keys[0] !== "blocked" || keys[1] !== "clear") return fail("distribution_invalid");
      const { clear, blocked } = probabilities;
      if (![clear, blocked].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
          Math.abs(clear + blocked - 1) > SUM_TOLERANCE) return fail("distribution_invalid");
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return fail("confidence_invalid");
      const other = choice === "clear" ? blocked : clear;
      const chosen = choice === "clear" ? clear : blocked;
      if (other - chosen > ROUNDING_STEP) return fail("choice_inconsistent");
      const noul = (id: string): number | null => {
        const parsed = noulAnswerSchema.safeParse(reply.data.answers[id]);
        return parsed.success && Number.isFinite(parsed.data.noul) && parsed.data.noul >= 0 && parsed.data.noul <= 1 ? parsed.data.noul : null;
      };
      const slur = configuration.slurQuestion ? noul(configuration.slurQuestion.id) : null;
      const vulgar = configuration.vulgarQuestion ? noul(configuration.vulgarQuestion.id) : null;
      if ((configuration.slurQuestion && slur === null) || (configuration.vulgarQuestion && vulgar === null)) return fail("noul_invalid");
      const disposition = dispositionFor({ blocked, slur, vulgar }, thresholdsFor(configuration));
      return { ok: true, result: {
        choice, probabilities: { clear, blocked }, confidence, blockedProbability: blocked,
        ...(configuration.slurQuestion ? { slurProbability: slur } : {}),
        ...(configuration.vulgarQuestion ? { vulgarProbability: vulgar } : {}),
        finding: disposition === "reject" ? "blocked" : "clear", disposition
      } };
    }
  };
}
