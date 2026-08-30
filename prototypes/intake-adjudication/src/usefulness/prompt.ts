// The versioned prompt and rubric for audience usefulness.
//
// Version 1 is deliberately close to one sentence. The criterion lives in the
// golden set, not in here: the labels are the definition of usefulness and the
// prompt is an attempt to reproduce them. A rubric written before any failure
// has been seen encodes guesses about imagined problems, and every clause added
// without evidence is one nobody will dare delete later.
//
// So this is expected to fail several of the six obvious rejects. That is the
// baseline, not a defect. Every later clause must trace to a case it fixed, and
// clauses should periodically be removed to check the score holds.
//
// What is NOT a rubric clause: the RULES block and the frequency scale. Those
// are contract plumbing and units on a number — without the scale the Zipf
// figure is noise, and frequency is the only evidence that separates `happy`
// from the words worth teaching.

import type { CandidateMeaning } from "./meaning.ts";

export const PROMPT_VERSION = "usefulness-prompt/1";
export const RUBRIC_VERSION = "usefulness-rubric/1";

export const RUBRIC = `You judge one recorded meaning of one English word.

WordWell teaches adults who are building a professional and academic vocabulary.
Decide whether this meaning is one worth learning for that purpose.

- useful: an adult building a professional and academic vocabulary would be
  better off knowing this meaning.
- not_useful: they would not.
- insufficient_evidence: the supplied evidence is missing or incomplete, so the
  question cannot be settled. Not a way to avoid a hard call.

RULES

- Closed book. Judge only on the evidence supplied below. Do not use anything you
  know about this word that is not in the evidence.
- You are judging the one meaning shown, not the word's other meanings.
- Cite only identifiers that appear in the evidence. Never invent one.
- Do not decide whether the word should be taught, published, kept or dropped.
  Something else decides that from your findings. Report what you found, not what
  should happen.`;

export function renderSubject(subject: CandidateMeaning): string {
  const { candidate, meaning } = subject;
  const lines = [
    "WORD",
    `word: ${candidate.display}`,
    `parts of speech recorded: ${candidate.pos.join(", ") || "none recorded"}`,
    // The scale matters: 1 is a word almost nobody writes, 7 is "the".
    `frequency (Zipf, 1 = very rare, 7 = among the commonest words in English): ${candidate.zipf ?? "MISSING FROM THE EVIDENCE"}`,
    "",
    "MEANING TO JUDGE",
    `${meaning.sense_id} (${meaning.pos}): ${meaning.definition}`,
  ];
  if (meaning.synset_members.length > 1) {
    lines.push(`  recorded alongside: ${meaning.synset_members.join(", ")}`);
  }
  for (const example of meaning.examples) lines.push(`  example: ${example}`);
  if (meaning.examples_truncated) lines.push("  (further examples omitted by the extractor)");

  lines.push(
    "",
    "MISSING EVIDENCE, recorded by the extractor",
    subject.missing_evidence.length
      ? subject.missing_evidence.map((m) => `  - ${m}`).join("\n")
      : "  (none)",
  );
  return lines.join("\n");
}

export function buildMessages(subject: CandidateMeaning): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: RUBRIC },
    { role: "user", content: renderSubject(subject) },
  ];
}
