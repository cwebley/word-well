// The input side of the contract: what export_evidence.py emits.
//
// Adjudication is closed-book, so a Claim is the complete world the judge sees.
// The one thing deliberately fenced off is `policy_context`, which carries
// endorsement. Endorsement says an editor found a word worth teaching; it says
// nothing about whether a proposed decomposition is true. It reaches the policy
// layer and the retention audit, never the prompt.

import { z } from "zod";

import { readJsonl } from "../jsonl.ts";

export const sourceMeaningSchema = z.object({
  sense_id: z.string(),
  pos: z.string(),
  lemma: z.string(),
  definition: z.string(),
  examples: z.array(z.string()),
  examples_truncated: z.boolean(),
  synset_members: z.array(z.string()),
});

export const componentSchema = z.object({
  role: z.string(),
  normalized: z.string(),
  display: z.string(),
  in_candidate_pool: z.boolean(),
  zipf: z.number().nullable(),
  source_meanings: z.array(sourceMeaningSchema),
});

export const ruleKinds = [
  "affix_strip",
  "compound_split",
  "grammatical_derivation",
  "meaning_shift_derivation",
  "lexicalised_participle",
] as const;

export const claimSchema = z.object({
  claim_id: z.string(),
  extraction_version: z.string(),
  input_digest: z.string(),
  candidate: z.object({
    normalized: z.string(),
    display: z.string(),
    pos: z.array(z.string()),
    zipf: z.number().nullable(),
    source_meanings: z.array(sourceMeaningSchema),
  }),
  claim: z.object({
    rule_kind: z.enum(ruleKinds),
    decomposition: z.record(z.string(), z.unknown()),
    components: z.array(componentSchema),
  }),
  missing_evidence: z.array(z.string()),
  policy_context: z.object({ endorsements: z.number() }),
});

export type SourceMeaning = z.infer<typeof sourceMeaningSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type RuleKind = (typeof ruleKinds)[number];

export function readClaims(path: string): Claim[] {
  return readJsonl(path, claimSchema);
}

/** Every source-meaning identifier the judge is allowed to be asked about. */
export function candidateSourceMeaningIds(claim: Claim): string[] {
  return claim.candidate.source_meanings.map((m) => m.sense_id);
}

/** Every identifier a finding may legitimately cite, from anywhere in the evidence. */
export function citableEvidenceIds(claim: Claim): Set<string> {
  const ids = new Set<string>(candidateSourceMeaningIds(claim));
  for (const component of claim.claim.components) {
    for (const meaning of component.source_meanings) ids.add(meaning.sense_id);
  }
  // Missing-evidence markers are citable too: "I cannot decide because
  // claim.root.zipf is absent" is a legitimate, checkable justification.
  for (const marker of claim.missing_evidence) ids.add(marker);
  return ids;
}
