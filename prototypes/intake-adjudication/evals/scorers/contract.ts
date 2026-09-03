// Contract scorers. Every one of these is deterministic and answers a question
// about the shape of the output, never about whether the judgment was right.
//
// They read `record.raw` rather than `record.finding`, so a single malformed
// response still reports independently on each requirement instead of
// collapsing into one "invalid" bit. That is what makes the failures legible.

import type { EvalScorer } from "braintrust";

import type { Claim } from "../../src/morphology/claim.ts";
import { candidateSourceMeaningIds, citableEvidenceIds } from "../../src/morphology/claim.ts";
import type { Finding } from "../../src/morphology/contract.ts";
import {
  analysisSupportValues,
  findingSchema,
  predictabilityValues,
} from "../../src/morphology/contract.ts";
import type { AdjudicationRecord } from "../../src/store.ts";
import type { ExpectedLabel } from "../types.ts";

type Scorer = EvalScorer<Claim, AdjudicationRecord<Finding>, ExpectedLabel>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rawMeanings(raw: Record<string, unknown> | null): Record<string, unknown>[] {
  return Array.isArray(raw?.meanings)
    ? raw.meanings.map(asObject).filter((m): m is Record<string, unknown> => m !== null)
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Did the provider return output the contract accepts at all? */
export const schemaValidScorer: Scorer = ({ output }) => {
  const parsed = findingSchema.safeParse(output.raw);
  return {
    name: "ContractSchemaValid",
    score: parsed.success ? 1 : 0,
    metadata: parsed.success
      ? {}
      : { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
  };
};

/** Are the two verdict fields drawn from the allowed vocabulary? */
export const enumValidScorer: Scorer = ({ output }) => {
  const raw = asObject(output.raw);
  if (!raw) return null;

  const checked: string[] = [String(raw.analysis_support)];
  for (const meaning of rawMeanings(raw)) checked.push(String(meaning.predictability));

  const allowed = new Set<string>([...analysisSupportValues, ...predictabilityValues]);
  const disallowed = checked.filter((value) => !allowed.has(value));

  return {
    name: "ContractEnumsAllowed",
    score: checked.length === 0 ? 0 : (checked.length - disallowed.length) / checked.length,
    metadata: { checked: checked.length, disallowed },
  };
};

/** Did the answer come back attached to the claim that was asked about? */
export const claimIdentityScorer: Scorer = ({ input, output }) => {
  const raw = asObject(output.raw);
  const returned = raw?.claim_id;
  return {
    name: "ContractClaimIdentity",
    score: returned === input.claim_id ? 1 : 0,
    metadata: { expected: input.claim_id, returned },
  };
};

/**
 * Is every candidate source meaning judged exactly once?
 *
 * A word-level verdict that quietly drops a meaning is the failure this gate
 * exists to prevent: one predictable sense must not hide another that teaches
 * something new. Missing, duplicated and invented identifiers are all faults.
 */
export const meaningAccountingScorer: Scorer = ({ input, output }) => {
  const expectedIds = candidateSourceMeaningIds(input);
  const cited = rawMeanings(asObject(output.raw)).flatMap((m) => strings(m.sense_ids));

  const counts = new Map<string, number>();
  for (const id of cited) counts.set(id, (counts.get(id) ?? 0) + 1);

  const missing = expectedIds.filter((id) => !counts.has(id));
  const duplicated = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  const invented = [...counts.keys()].filter((id) => !expectedIds.includes(id));

  const faults = missing.length + duplicated.length + invented.length;
  return {
    name: "ContractMeaningAccounting",
    score: expectedIds.length === 0 ? 0 : Math.max(0, 1 - faults / expectedIds.length),
    metadata: { expected: expectedIds.length, missing, duplicated, invented },
  };
};

/** Does every cited identifier actually appear in the evidence that was supplied? */
export const evidenceCitationScorer: Scorer = ({ input, output }) => {
  const raw = asObject(output.raw);
  const cited = [
    ...strings(raw?.analysis_evidence_ids),
    ...rawMeanings(raw).flatMap((m) => strings(m.evidence_ids)),
  ];
  // Nothing cited: this scorer's question does not apply. Whether the judge
  // should have cited something is a rubric question for human review.
  if (cited.length === 0) return null;

  const citable = citableEvidenceIds(input);
  const bad = cited.filter((id) => !citable.has(id));

  return {
    name: "ContractEvidenceExists",
    score: (cited.length - bad.length) / cited.length,
    metadata: { cited: cited.length, invented: [...new Set(bad)] },
  };
};

const DISPOSITION_KEY = /disposition|decision|verdict|recommend|action|outcome|status|advance|exclude|quarantine/i;

/**
 * Did the model stay on its side of the line?
 *
 * The strict schema should already make this impossible, which is the point:
 * this scorer is the alarm that fires if the contract is ever loosened and the
 * model starts returning a serving decision that policy is supposed to derive.
 */
export const noInventedDispositionScorer: Scorer = ({ output }) => {
  const offending: string[] = [];
  const walk = (value: unknown, path: string): void => {
    const obj = asObject(value);
    if (obj) {
      for (const [key, child] of Object.entries(obj)) {
        if (DISPOSITION_KEY.test(key)) offending.push(path ? `${path}.${key}` : key);
        walk(child, path ? `${path}.${key}` : key);
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i}]`));
  };
  walk(output.raw, "");

  return {
    name: "ContractNoInventedDisposition",
    score: offending.length === 0 ? 1 : 0,
    metadata: { offending },
  };
};

export const contractScorers = [
  schemaValidScorer,
  enumValidScorer,
  claimIdentityScorer,
  meaningAccountingScorer,
  evidenceCitationScorer,
  noInventedDispositionScorer,
];
