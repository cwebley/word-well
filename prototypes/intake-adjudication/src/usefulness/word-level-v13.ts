import { createHash } from "node:crypto";

import { z } from "zod";

import { canonicalJson } from "../fingerprint.ts";
import type { HeadwordGroup } from "./run.ts";

export const V13_RUBRIC = `You judge one English headword for WordWell.

WordWell teaches literate adults who want words that improve their expressive
range. A good lesson gives the learner a precise, memorable word they are glad
to know and could naturally use in conversation or writing.

Judge the headword as a whole from your general knowledge of English. Consider
the meanings and uses an educated adult would ordinarily encounter. Do not hunt
for an obscure, archaic, regional, or technical sense that could rescue an
otherwise mundane word.

FAMILIARITY

- common: most educated adults already know and understand the headword
- less_common: broadly recognizable, but mastery may still add useful precision
- uncommon: many educated adults are unlikely to know the headword
- unknown: you do not confidently know the headword

SCOPE

- general: useful across ordinary, literary, professional, or academic contexts
- specialist_subject: primarily belongs to one discipline, trade, hobby,
  taxonomy, or narrow factual domain
- sensitive_body_or_medical: primarily concerns anatomy, sexual or reproductive
  matters, bodily functions, a medical condition, or a treatment
- unknown: you cannot confidently judge its scope

LEARNING VALUE

- high: mastering the headword adds expressive precision or names a worthwhile
  concept and gives a literate adult a natural reason to use it
- low: it is mundane, elementary, transparent, merely derivative, narrowly
  factual, or unlikely to reward deliberate study
- unknown: you cannot confidently judge its learning value

A common or recognizable headword may still have high learning value when
mastering its distinctions materially improves expression. Broad applicability
alone does not make an elementary word worth teaching. Do not promote a familiar
word because one unusual sense sounds formal. Do not penalize a useful word only
because it is rare.

Report these properties only. Do not decide whether the word should be taught,
published, kept, or dropped; deterministic policy makes that decision.`;

export const V14_RUBRIC = `You judge one English headword for WordWell.

WordWell teaches literate adults words that expand expressive range. Judge the
headword as a whole, using your general knowledge of ordinary English usage.
Do not rescue a mundane word with a niche, archaic, regional, or technical use.

Record these properties.

FAMILIARITY

- common: most educated adults already know the headword
- less_common: broadly recognizable, but not used routinely by most adults
- uncommon: many educated adults are unlikely to know the headword
- unknown: you do not know the headword confidently

SCOPE

- general: useful across many contexts
- specialist_subject: primarily confined to one discipline, trade, hobby,
  taxonomy, or narrow factual domain
- sensitive_body_or_medical: primarily concerns anatomy, sexual or reproductive
  matters, bodily functions, a medical condition, or a treatment
- unknown: you cannot confidently judge the scope

LEARNING VALUE

- high: mastering the headword adds expressive precision or names a worthwhile
  concept and gives a natural reason to use it
- low: it is mundane, elementary, narrowly factual, or unlikely to reward
  deliberate study
- unknown: you cannot confidently judge its learning value

Report only the headword, these three properties, and a brief rationale. Do not
decide whether the word should be taught, kept, dropped, or advanced.`;

export const wordLevelFindingSchema = z.strictObject({
  headword: z.string(),
  familiarity: z.enum(["common", "less_common", "uncommon", "unknown"]),
  scope: z.enum(["general", "specialist_subject", "sensitive_body_or_medical", "unknown"]),
  learning_value: z.enum(["high", "low", "unknown"]),
  rationale: z.string(),
});

export type WordLevelFinding = z.infer<typeof wordLevelFindingSchema>;

export interface HeadwordSubject {
  subject_id: string;
  input_digest: string;
  normalized: string;
  display: string;
  parts_of_speech: string[];
  policy_context: { endorsements: number };
}

export function buildHeadwordSubject(group: HeadwordGroup): HeadwordSubject {
  const partsOfSpeech = [...new Set(group.meanings.flatMap((meaning) => meaning.candidate.pos))].sort();
  const input = {
    headword: group.display,
    parts_of_speech: partsOfSpeech,
  };
  return {
    subject_id: group.headword,
    input_digest: createHash("sha256").update(canonicalJson(input)).digest("hex"),
    normalized: group.headword,
    display: group.display,
    parts_of_speech: partsOfSpeech,
    policy_context: {
      endorsements: Math.max(...group.meanings.map((meaning) => meaning.policy_context.endorsements)),
    },
  };
}

export function renderWordLevelSubject(subject: HeadwordSubject): string {
  return [
    "HEADWORD",
    `word: ${subject.display}`,
    `recorded parts of speech: ${subject.parts_of_speech.join(", ") || "none recorded"}`,
  ].join("\n");
}

export type WordLevelVerdict = "useful" | "not_useful" | "insufficient_knowledge";

export function wordLevelVerdict(finding: WordLevelFinding): WordLevelVerdict {
  if (
    finding.familiarity === "unknown" ||
    finding.scope === "unknown" ||
    finding.learning_value === "unknown"
  ) {
    return "insufficient_knowledge";
  }
  if (finding.scope !== "general" || finding.learning_value === "low") return "not_useful";
  return "useful";
}
