// Contract scorers for the usefulness gate. Deterministic, and every one asks a
// question about the shape of the output, never about whether the judgment was
// right.
//
// They read `record.raw` rather than `record.finding`, so a single malformed
// reply reports independently against each requirement instead of collapsing
// into one "invalid" bit. That is what makes the failures legible.
//
// The unit is a headword, because that is the unit the label is written at, so
// each scorer averages across the headword's per-meaning calls.

import type { EvalScorer } from "braintrust";

import { usefulnessFindingSchema, usefulnessValues } from "../../src/usefulness/contract.ts";
import { citableEvidenceIds } from "../../src/usefulness/meaning.ts";
import type { HeadwordOutcome } from "../../src/usefulness/run.ts";
import type { UsefulnessCase } from "../usefulness-datasets.ts";

type Scorer = EvalScorer<UsefulnessCase["group"], HeadwordOutcome, UsefulnessCase["expected"]>;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function ratio(good: number, total: number): number {
  return total === 0 ? 0 : good / total;
}

/** Did the provider return output the contract accepts at all? */
export const schemaValidScorer: Scorer = ({ output }) => {
  const failures = output.records
    .map((record, i) => ({ i, parsed: usefulnessFindingSchema.safeParse(record.raw) }))
    .filter(({ parsed }) => !parsed.success);
  return {
    name: "ContractSchemaValid",
    score: ratio(output.records.length - failures.length, output.records.length),
    metadata: {
      meanings: output.records.length,
      issues: failures.flatMap(({ i, parsed }) =>
        parsed.success ? [] : parsed.error.issues.map((issue) => `${i}: ${issue.path.join(".")} ${issue.message}`),
      ),
    },
  };
};

/** Is the verdict drawn from the allowed vocabulary? */
export const enumValidScorer: Scorer = ({ output }) => {
  const allowed = new Set<string>(usefulnessValues);
  const checked = output.records.map((record) => String(asObject(record.raw)?.usefulness));
  const disallowed = checked.filter((value) => !allowed.has(value));
  return {
    name: "ContractEnumsAllowed",
    score: ratio(checked.length - disallowed.length, checked.length),
    metadata: { checked: checked.length, disallowed },
  };
};

/**
 * Did each answer come back attached to the meaning it was asked about?
 *
 * A well-formed finding on the wrong sense scores as a valid judgment unless
 * something checks. With a per-meaning fan-out there are more chances to get it
 * wrong, so this matters more here than it did for morphology.
 */
export const meaningIdentityScorer: Scorer = ({ input, output }) => {
  const asked = input.meanings.map((m) => m.meaning.sense_id);
  const mismatches = output.records
    .map((record, i) => ({ expected: asked[i], returned: asObject(record.raw)?.sense_id }))
    .filter(({ expected, returned }) => returned !== expected);
  return {
    name: "ContractMeaningIdentity",
    score: ratio(output.records.length - mismatches.length, output.records.length),
    metadata: { asked: asked.length, mismatches },
  };
};

/**
 * Did every meaning of this headword get a usable finding?
 *
 * The fold leans toward admitting, so a meaning that quietly produced nothing is
 * a meaning that cannot rescue its headword. This is the scorer that notices.
 */
export const meaningCoverageScorer: Scorer = ({ input, output }) => {
  const judged = output.records.filter((record) => record.finding !== null).length;
  return {
    name: "ContractMeaningCoverage",
    score: ratio(judged, input.meanings.length),
    metadata: {
      meanings: input.meanings.length,
      judged,
      contract_failures: output.contractFailures,
    },
  };
};

/** Does every cited identifier actually appear in the evidence that was supplied? */
export const evidenceCitationScorer: Scorer = ({ input, output }) => {
  let cited = 0;
  const invented: string[] = [];
  output.records.forEach((record, i) => {
    const subject = input.meanings[i];
    if (!subject) return;
    const citable = citableEvidenceIds(subject);
    for (const id of strings(asObject(record.raw)?.evidence_ids)) {
      cited += 1;
      if (!citable.has(id)) invented.push(id);
    }
  });
  // Nothing cited: this scorer's question does not apply. Whether the judge
  // should have cited something is a rubric question for human review.
  if (cited === 0) return null;
  return {
    name: "ContractEvidenceExists",
    score: ratio(cited - invented.length, cited),
    metadata: { cited, invented: [...new Set(invented)] },
  };
};

const DISPOSITION_KEY =
  /disposition|decision|verdict|recommend|action|outcome|status|advance|exclude|quarantine|serve|reject/i;

/**
 * Did the model stay on its side of the line?
 *
 * The strict schema should already make this impossible, which is the point:
 * this is the alarm that fires if the contract is ever loosened and the model
 * starts returning the serving decision that policy is supposed to derive.
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
  output.records.forEach((record, i) => walk(record.raw, `meaning[${i}]`));
  return { name: "ContractNoInventedDisposition", score: offending.length === 0 ? 1 : 0, metadata: { offending } };
};

export const usefulnessContractScorers = [
  schemaValidScorer,
  enumValidScorer,
  meaningIdentityScorer,
  meaningCoverageScorer,
  evidenceCitationScorer,
  noInventedDispositionScorer,
];
