import { QUESTIONS } from "../stages/usefulness.js";
import { PINNED_MODEL_VERSION, type JevAnswers } from "../execution/jev.js";
import type { ScriptedReply } from "./private-fixtures.js";

// Harmless synthetic measurements. Recognition 1.8 advances at the promoted
// cutoff; 1.9 falls between the original and promoted cutoffs.
export function usefulnessMeasurements(recognition = 1.8): JevAnswers {
  const answers: JevAnswers = {};
  for (const [name, question] of Object.entries(QUESTIONS)) {
    if (question.type === "noul") answers[name] = { type: "noul", noul: 0 };
    else if (question.type === "score") answers[name] = { type: "score", score: 3,
      probabilities: Object.fromEntries(question.criteria.map((_, i) => [String(i), i === 3 ? 1 : 0])), confidence: 1 };
    else {
      const options = Object.keys(question.criteria);
      answers[name] = { type: "choice", choice: options[0], probabilities: Object.fromEntries(options.map((key, i) => [key, i === 0 ? 1 : 0])), confidence: 1 };
    }
  }
  answers.prior_recognition = { type: "score", score: recognition, probabilities: { "0": 0, "1": 2 - recognition, "2": recognition - 1, "3": 0 }, confidence: 2 * recognition - 3 };
  return answers;
}
export function usefulnessReply(recognition = 1.8, overrides: Record<string, unknown> = {}): ScriptedReply {
  return { status: 200, body: JSON.stringify({ model: PINNED_MODEL_VERSION, answers: usefulnessMeasurements(recognition),
    usage: { input_tokens: 2000, output_tokens: 100, cost: 0.000084 }, ...overrides }) };
}
