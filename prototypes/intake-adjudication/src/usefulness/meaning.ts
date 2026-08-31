// The input side of the usefulness contract: what export_usefulness_evidence.py
// emits.
//
// The subject is one **source meaning**, not a headword. Stage 2 measured the
// cost of the alternative: three of its four errors sat inside a multi-sense
// group whose single rationale was true only of the easiest member. One call per
// meaning is more calls, and at 12-25 cases that is pennies.
//
// `policy_context` carries endorsement and is fenced off from the prompt, as it
// is for morphology. For this gate it is fenced off from policy too — see
// `policy.ts`.

import { z } from "zod";

import { readJsonl } from "../jsonl.ts";

export const meaningSchema = z.object({
  sense_id: z.string(),
  pos: z.string(),
  lemma: z.string(),
  definition: z.string(),
  examples: z.array(z.string()),
  examples_truncated: z.boolean(),
  synset_members: z.array(z.string()),
});

export const candidateMeaningSchema = z.object({
  subject_id: z.string(),
  extraction_version: z.string(),
  input_digest: z.string(),
  candidate: z.object({
    normalized: z.string(),
    display: z.string(),
    pos: z.array(z.string()),
    zipf: z.number().nullable(),
    /** How many meanings this headword has in total, for reporting, not judging. */
    meaning_count: z.number(),
  }),
  meaning: meaningSchema,
  missing_evidence: z.array(z.string()),
  policy_context: z.object({ endorsements: z.number() }),
});

export type Meaning = z.infer<typeof meaningSchema>;
export type CandidateMeaning = z.infer<typeof candidateMeaningSchema>;

export function readCandidateMeanings(path: string): CandidateMeaning[] {
  return readJsonl(path, candidateMeaningSchema);
}

/** The headword a meaning belongs to. Policy aggregates on this. */
export function headwordOf(subject: CandidateMeaning): string {
  return subject.candidate.normalized;
}

export interface EvidenceItem {
  /** The label the judge cites: E1, E2, … */
  id: string;
  kind: "definition" | "example" | "synonyms" | "part_of_speech" | "missing";
  text: string;
}

/**
 * Every piece of evidence, each with a label the judge can point at.
 *
 * Version 1 asked the judge to cite "identifiers from the supplied evidence"
 * when the only identifier in the whole prompt was the sense id. That is a
 * question with one possible answer, and the measured result was that the judge
 * invented identifier-shaped names for the things it actually used — `pinnate`
 * cited `frequency_Zipf_2.17`, `definition_leaf_shape_featherlike` and
 * `part_of_speech_a`, all real evidence, none of it nameable.
 *
 * Numbering the evidence makes the citation both possible and checkable, and it
 * buys something version 1 could not answer: *which* evidence drove the verdict.
 * That is the open question behind the `happy` failure — whether frequency is
 * being read at all, and in which direction.
 */
export function evidenceItems(subject: CandidateMeaning): EvidenceItem[] {
  const { candidate, meaning } = subject;
  const items: Omit<EvidenceItem, "id">[] = [
    { kind: "definition", text: meaning.definition },
  ];
  for (const example of meaning.examples) {
    items.push({ kind: "example", text: example });
  }
  if (meaning.synset_members.length > 1) {
    items.push({ kind: "synonyms", text: meaning.synset_members.join(", ") });
  }
  // Frequency is deliberately absent since usefulness-prompt/3.
  //
  // It was measured doing more harm than any other single field. Of 164
  // rejections whose rationale invoked rarity, 162 cited this label directly:
  // 12 of 12 in the retention audit, 81 of 86 in exploration draw 1, and `happy`
  // in the golden set. The judge read it monotonically — common counted for,
  // rare counted against — when the criterion is a band, and at the low end
  // rarity is closer to the point than to a defect. `beneficence`, `noisome`
  // and `refulgent` are exactly what this product teaches, and all were dropped
  // for being rare.
  //
  // Removing it worked: rarity reasoning fell from 147 rejections to 2. The band
  // is now a deterministic filter, `intake_filters.py`, which answers "too
  // common" for free and more reliably.
  //
  // The prompt says nothing about rarity either. Removing the evidence was
  // sufficient on its own, and a clause added before it is shown to be needed is
  // a clause nobody will dare delete.
  items.push({ kind: "part_of_speech", text: meaning.pos });
  for (const marker of subject.missing_evidence) {
    items.push({ kind: "missing", text: marker });
  }
  return items.map((item, i) => ({ ...item, id: `E${i + 1}` }));
}

/** Every label a finding may legitimately cite. */
export function citableEvidenceIds(subject: CandidateMeaning): Set<string> {
  return new Set(evidenceItems(subject).map((item) => item.id));
}
