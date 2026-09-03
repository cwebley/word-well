// Morphology assembled as a gate.
//
// Nothing about the judgment changed here: the contract, prompt, rubric and
// policy are the ones stage 2 ran, at the same versions, so every persisted
// fingerprint still resolves. This file only says which of them the shared
// runner should use.

import type { Gate } from "../gate.ts";
import { parseFinding } from "../parse.ts";
import type { Claim } from "./claim.ts";
import type { Finding } from "./contract.ts";
import { CONTRACT_VERSION, findingJsonSchema, findingSchema } from "./contract.ts";
import { applyEndorsement, deriveMorphologyDisposition, POLICY_VERSION, verdictOf } from "./policy.ts";
import { buildMessages, PROMPT_VERSION, RUBRIC_VERSION } from "./prompt.ts";

export const morphologyGate: Gate<Claim, Finding> = {
  name: "morphology",
  versions: {
    prompt: PROMPT_VERSION,
    rubric: RUBRIC_VERSION,
    contract: CONTRACT_VERSION,
    policy: POLICY_VERSION,
  },
  jsonSchema: findingJsonSchema as Record<string, unknown>,

  subjectId: (claim) => claim.claim_id,
  inputDigest: (claim) => claim.input_digest,
  buildMessages,

  parse: (content, claim) =>
    parseFinding(content, findingSchema, claim.claim_id, (f) => f.claim_id, CONTRACT_VERSION),

  decide: (finding) => deriveMorphologyDisposition(verdictOf(finding)),

  // Endorsement overrides a fuzzy morphology exclusion and nothing else. It
  // reaches policy here, never `buildMessages`.
  applyContext: (decision, claim) =>
    applyEndorsement(decision, claim.policy_context.endorsements),

  policyContext: (claim) => ({ endorsements: claim.policy_context.endorsements }),
};

/** How a morphology finding reads in `runs/`, for a human, not a machine. */
export function summariseFinding(finding: Finding): string {
  return `${finding.analysis_support}; meanings ${finding.meanings.map((m) => m.predictability).join(", ")}`;
}
