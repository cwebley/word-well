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
// Version 5 removes the everyday-vocabulary clause that versions 3 and 4
// carried. It cannot be made to work by rewording, and the reason is structural:
// it asked a language model whether a competent adult would already know a word,
// of a system that knows every word. Version 3 said "meaning", version 4 said
// "word", and the already-known reasoning barely moved — 272 rejections to 236,
// against a version 2 baseline of 51. Under version 4 the audit dropped
// `rescind` (6 endorsements) as "covered by common words like cancel and
// revoke", along with `confound`, `underscore`, `imminent` and `lampoon`.
//
// Retention fell from 88.0% to 51.0% while the golden set rose to 14/15, which
// is the whole argument for keeping an unlabelled instrument: fifteen cases said
// the change was the best yet and a hundred said it was dropping half the words
// editors chose.
//
// The everyday end is now the deterministic filter's job alone. `happy` is Zipf
// 5.38 against a 4.0 ceiling and never reaches a prompt. Words like `chanted`
// (3.0) and `pout` (3.1) sit inside the band and will get through; a ceiling
// low enough to catch them would also cut `ubiquitous` (3.42) and `nuance`
// (3.43). Admitting a few obvious words is the cheaper error, because a wrong
// admit is visible in the app and a wrong exclude is silent.
//
// Version 6 was the third and last attempt, framing the question as whether a
// young-adult novel would print the word unglossed — asking where a word lives
// rather than what a reader knows. It reached v3's numbers to the decimal: 43.0%
// retention, 8.7% exploration.
//
// It failed differently enough to be conclusive. The judge ENGAGED with the
// framing — 240 of 414 rejections named the YA novel — and still rejected
// `austere` as "easily understood by a general audience and would likely appear
// in young adult literature without needing explanation".
//
// The reason is in the evidence, not the wording. The only thing the judge is
// shown about a word is a definition written in deliberately plain language,
// because that is what a gloss is. `austere` is defined as "severely simple",
// which reads plainly, so the word looks plain. Every word in the dictionary
// looks plain by that test.
//
// Judging register needs evidence of how a word behaves in prose. Half the
// meanings carry no examples at all, and the examples that exist are
// synset-level and often use a different member word. The signal is not there,
// so no clause can extract it. The everyday end stays the deterministic
// filter's problem until the evidence changes.

import type { CandidateMeaning } from "./meaning.ts";
import { evidenceItems } from "./meaning.ts";

export const PROMPT_VERSION = "usefulness-prompt/5";
export const RUBRIC_VERSION = "usefulness-rubric/5";

export const RUBRIC = `You judge one recorded meaning of one English word.

WordWell teaches adults who are building a professional and academic vocabulary:
high-utility words that carry across many subjects.

Vocabulary belonging to one field is not that. A term used mainly inside a
single discipline is not_useful, even when that discipline is an academic one.
"Academic" describes register that carries across subjects, not whether some
field uses the word.

Decide whether this meaning is one worth learning.

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
