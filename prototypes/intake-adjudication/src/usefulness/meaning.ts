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

/** Every identifier a finding may legitimately cite. */
export function citableEvidenceIds(subject: CandidateMeaning): Set<string> {
  const ids = new Set<string>([subject.meaning.sense_id]);
  for (const marker of subject.missing_evidence) ids.add(marker);
  return ids;
}
