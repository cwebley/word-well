import { z } from "zod";

import type { CandidateMeaning } from "./meaning.ts";
import { evidenceItems } from "./meaning.ts";

export const V10_RUBRIC = `You judge one recorded meaning of one English word.

WordWell teaches literate adults who want words that improve their expressive
range. A good lesson gives the learner a precise, memorable word they are glad
to know and could naturally use in conversation or writing.

Judge three properties of the word for the one meaning shown.

FAMILIARITY

- common: most educated adults already know and understand this word in this
  meaning; deliberate teaching adds little
- less_common: broadly recognizable, but this exact word or meaning may still
  add useful precision
- uncommon: many educated adults are unlikely to know this word in this meaning
- unknown: the supplied evidence cannot support a familiarity judgment

SCOPE

- general: useful across ordinary, literary, professional, or academic contexts
- specialist_subject: used mainly inside one discipline, trade, hobby, taxonomy,
  or narrow factual domain
- sensitive_body_or_medical: primarily anatomy, sexual or reproductive matters,
  bodily functions, a medical condition, or a treatment
- unknown: the supplied evidence cannot support a scope judgment

LEARNING VALUE

- high: a well-read adult could be pleasantly surprised to learn it, it adds
  expressive precision or names a worthwhile concept, and there is a natural
  reason to use it
- low: it is mundane, obvious, transparent, merely derivative, narrowly factual,
  or unlikely to reward deliberate study even if it can appear in advanced text
- unknown: the supplied evidence cannot support a learning-value judgment

Appearing in a high-school, AP English, college, or graduate text does not by
itself make a word worth teaching. Do not promote a familiar word merely because
one part of speech or source meaning sounds formal. Straightforward inflections,
derivatives, and prefixed forms usually have low learning value unless the word
adds a non-obvious meaning or useful precision.

RULES

- Use the supplied evidence to identify the meaning. Do not introduce an
  unshown meaning or factual claim. You may use general language knowledge about
  how familiar the word is and whether learning it would reward this audience.
- You are judging the one meaning shown, not the word's other meanings.
- Every piece of evidence carries a label: E1, E2, and so on. In evidence_ids,
  list the labels your verdict actually rests on. Use only labels shown below.
- Do not decide whether the word should be taught, published, kept or dropped.
  Something else decides that from your findings. Report what you found, not what
  should happen.`;

export const teachingValueFindingSchema = z.strictObject({
  sense_id: z.string(),
  familiarity: z.enum(["common", "less_common", "uncommon", "unknown"]),
  scope: z.enum(["general", "specialist_subject", "sensitive_body_or_medical", "unknown"]),
  learning_value: z.enum(["high", "low", "unknown"]),
  rationale: z.string(),
  evidence_ids: z.array(z.string()),
});

export type TeachingValueFinding = z.infer<typeof teachingValueFindingSchema>;
export type TeachingValueVerdict = "useful" | "not_useful" | "insufficient_evidence";

const LABELS: Record<string, string> = {
  definition: "definition",
  example: "example",
  synonyms: "recorded alongside",
  part_of_speech: "part of speech",
  missing: "MISSING FROM THE EVIDENCE, recorded by the extractor",
};

export function renderTeachingValueSubject(
  subject: CandidateMeaning,
  options: { includeDefinition?: boolean; includeSynonyms: boolean },
): string {
  const lines = [
    "WORD",
    `word: ${subject.candidate.display}`,
    `parts of speech recorded for the word: ${subject.candidate.pos.join(", ") || "none recorded"}`,
    "",
    `MEANING TO JUDGE: ${subject.meaning.sense_id}`,
    "",
    "EVIDENCE",
  ];
  for (const item of evidenceItems(subject)) {
    if (options.includeDefinition === false && item.kind === "definition") continue;
    if (!options.includeSynonyms && item.kind === "synonyms") continue;
    lines.push(`[${item.id}] ${LABELS[item.kind]}: ${item.text}`);
  }
  if (subject.meaning.examples_truncated) lines.push("(further examples omitted by the extractor)");
  return lines.join("\n");
}

export function teachingValueVerdict(finding: TeachingValueFinding): TeachingValueVerdict {
  if (
    finding.familiarity === "unknown" ||
    finding.scope === "unknown" ||
    finding.learning_value === "unknown"
  ) {
    return "insufficient_evidence";
  }
  if (
    finding.familiarity === "common" ||
    finding.scope !== "general" ||
    finding.learning_value === "low"
  ) {
    return "not_useful";
  }
  return "useful";
}
