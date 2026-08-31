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
import { evidenceItems } from "./meaning.ts";

export const PROMPT_VERSION = "usefulness-prompt/2";
export const RUBRIC_VERSION = "usefulness-rubric/2";

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
- Every piece of evidence carries a label: E1, E2, and so on. In evidence_ids,
  list the labels your verdict actually rests on. Use only labels shown below.
- Do not decide whether the word should be taught, published, kept or dropped.
  Something else decides that from your findings. Report what you found, not what
  should happen.`;

const LABELS: Record<string, string> = {
  definition: "definition",
  example: "example",
  // Left exactly as version 1 worded it. Explaining that the definition is
  // shared — and so the examples may be about a synonym rather than this word —
  // is a real change to what the judge understands, and 61% of the golden set's
  // examples do not contain the word being judged. It is a candidate change with
  // a case behind it, which makes it a deliberate experiment, not a tidy-up to
  // fold into a contract bump.
  synonyms: "recorded alongside",
  // The scale matters: 1 is a word almost nobody writes, 7 is "the".
  frequency: "frequency (Zipf, 1 = very rare, 7 = among the commonest words in English)",
  part_of_speech: "part of speech",
  missing: "MISSING FROM THE EVIDENCE, recorded by the extractor",
};

export function renderSubject(subject: CandidateMeaning): string {
  const { candidate, meaning } = subject;
  const lines = [
    "WORD",
    `word: ${candidate.display}`,
    `parts of speech recorded for the word: ${candidate.pos.join(", ") || "none recorded"}`,
    "",
    `MEANING TO JUDGE: ${meaning.sense_id}`,
    "",
    "EVIDENCE",
  ];
  for (const item of evidenceItems(subject)) {
    lines.push(`[${item.id}] ${LABELS[item.kind]}: ${item.text}`);
  }
  if (meaning.examples_truncated) {
    lines.push("(further examples omitted by the extractor)");
  }
  return lines.join("\n");
}

export function buildMessages(subject: CandidateMeaning): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: RUBRIC },
    { role: "user", content: renderSubject(subject) },
  ];
}
