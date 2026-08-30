// The versioned prompt and rubric.
//
// Two separate version strings because they change for different reasons and
// both key the config fingerprint: the rubric is the standard a verdict is held
// to, the prompt is how that standard is delivered. A rubric change invalidates
// human labels; a prompt change does not.

import type { Claim, Component, SourceMeaning } from "./claim.ts";

export const PROMPT_VERSION = "morphology-prompt/1";
export const RUBRIC_VERSION = "morphology-rubric/1";

export const RUBRIC = `You judge a single mechanical claim about how one English word is formed.

A rule in a content pipeline proposed a decomposition. The rule works by string
matching and frequency, so it regularly invents word formation that does not
exist: "rebut" is not "re" + "but", "pastoral" is not "past" + "oral". Your job
is to say whether the proposed analysis is real, and separately whether each
recorded meaning of the word follows from it.

ANALYSIS SUPPORT — is the claimed decomposition a real account of this word?

- supported: the word really is formed from the claimed root or components, as
  an English speaker would recognise the relationship. A historical relationship
  that is still visible in the modern word counts.
- unsupported: the match is a string coincidence, the claimed root is the wrong
  part of speech to build this word, or the relationship runs the other way.
- insufficient_evidence: the supplied evidence does not settle it. Use this when
  a component's meanings or frequency are missing and their absence is what
  stops you deciding.

PREDICTABILITY — for each recorded meaning of the word, could a learner who
already knows the claimed root or components arrive at this meaning?

- predictable: the meaning is what the parts add up to. The word teaches a
  learner who knows the parts nothing new.
- not_predictable: the meaning carries something the parts do not give — a
  figurative extension, a specialised or technical sense, or drift away from the
  root. "mercurial" meaning "liable to sudden unpredictable change" is not
  predictable from the metal, even though the derivation is real.
- insufficient_evidence: the supplied evidence cannot settle it.

Judge predictability only when the analysis is supported or partly supported. If
the analysis is unsupported, still list every meaning, and mark each one
insufficient_evidence unless a component genuinely bears on it.

RULES

- Closed book. Judge only on the evidence supplied below. Do not use anything you
  know about these words that is not in the evidence, and do not guess at
  evidence marked missing.
- Account for every candidate source meaning exactly once, across all groups.
- Cite only identifiers that appear in the evidence. Never invent one.
- Do not decide whether the word is useful to a learner, or whether it should be
  taught, published, kept, or dropped. Something else decides that from your
  findings. Report what you found, not what should happen.
- The word's frequency describes how common it is. It is not evidence about
  whether the decomposition is real.`;

function renderMeaning(meaning: SourceMeaning): string {
  const lines = [`  - ${meaning.sense_id} (${meaning.pos}): ${meaning.definition}`];
  if (meaning.synset_members.length > 1) {
    lines.push(`    recorded alongside: ${meaning.synset_members.join(", ")}`);
  }
  for (const example of meaning.examples) lines.push(`    example: ${example}`);
  if (meaning.examples_truncated) lines.push("    (further examples omitted by the extractor)");
  return lines.join("\n");
}

function renderComponent(component: Component): string {
  const zipf =
    component.zipf === null
      ? "frequency: MISSING FROM THE EVIDENCE"
      : `frequency (Zipf): ${component.zipf}`;
  const meanings = component.source_meanings.length
    ? component.source_meanings.map(renderMeaning).join("\n")
    : "  (no recorded meanings in the evidence)";
  return `${component.role}: ${component.display}\n  ${zipf}\n${meanings}`;
}

export function renderClaim(claim: Claim): string {
  const { candidate } = claim;
  const decomposition = JSON.stringify(claim.claim.decomposition, null, 2);
  const missing = claim.missing_evidence.length
    ? claim.missing_evidence.map((m) => `  - ${m}`).join("\n")
    : "  (none)";

  return `CLAIM
claim_id: ${claim.claim_id}
rule kind: ${claim.claim.rule_kind}
proposed decomposition:
${decomposition}

CANDIDATE
word: ${candidate.display}
parts of speech recorded: ${candidate.pos.join(", ") || "none recorded"}
frequency (Zipf): ${candidate.zipf ?? "MISSING FROM THE EVIDENCE"}
source meanings, every one of which your findings must account for:
${candidate.source_meanings.map(renderMeaning).join("\n")}

CLAIMED ROOT OR COMPONENTS
${claim.claim.components.map(renderComponent).join("\n\n") || "(none supplied)"}

MISSING EVIDENCE, recorded by the extractor
${missing}`;
}

export function buildMessages(claim: Claim): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: RUBRIC },
    { role: "user", content: renderClaim(claim) },
  ];
}
