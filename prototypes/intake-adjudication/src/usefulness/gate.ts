// Audience usefulness assembled as a gate.
//
// Note the absent `applyContext`. Morphology has one because an editor who put a
// word on a study guide has better evidence than a string heuristic guessing at
// word formation. This gate has none, and the reason is the retention audit:
// its sample is ~100 endorsed words, and a policy that advanced endorsed words
// by rule would make the audit report its own override back as a retention rate.
// Endorsement is still recorded on every run for correlation — it just decides
// nothing here, and it never reaches the prompt.

import type { Gate } from "../gate.ts";
import { parseFinding } from "../parse.ts";
import type { UsefulnessFinding } from "./contract.ts";
import { CONTRACT_VERSION, usefulnessFindingSchema, usefulnessJsonSchema } from "./contract.ts";
import type { CandidateMeaning } from "./meaning.ts";
import { buildMessages, PROMPT_VERSION, RUBRIC_VERSION } from "./prompt.ts";
import { deriveUsefulness, POLICY_VERSION, verdictOf } from "./policy.ts";

export const usefulnessGate: Gate<CandidateMeaning, UsefulnessFinding> = {
  name: "audience-usefulness",
  versions: {
    prompt: PROMPT_VERSION,
    rubric: RUBRIC_VERSION,
    contract: CONTRACT_VERSION,
    policy: POLICY_VERSION,
  },
  jsonSchema: usefulnessJsonSchema as Record<string, unknown>,

  subjectId: (subject) => subject.subject_id,
  inputDigest: (subject) => subject.input_digest,
  buildMessages,

  parse: (content, subject) =>
    parseFinding(
      content,
      usefulnessFindingSchema,
      subject.meaning.sense_id,
      (f) => f.sense_id,
      CONTRACT_VERSION,
    ),

  decide: (finding) => deriveUsefulness(verdictOf(finding)),

  policyContext: (subject) => ({ endorsements: subject.policy_context.endorsements }),
};

/** How a usefulness finding reads in `runs/`, for a human, not a machine. */
export function summariseFinding(finding: UsefulnessFinding): string {
  return `${finding.usefulness} — ${finding.rationale}`;
}
