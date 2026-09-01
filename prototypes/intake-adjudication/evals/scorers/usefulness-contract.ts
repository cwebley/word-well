// Contract scorers for the usefulness gate. Deterministic, and every one asks a
// question about the shape of the output, never whether the judgment was right.
//
// There are four, not the original six, and the reduction is the point. Three of
// the originals — schema validity, allowed enums, no invented disposition — check
// things the provider's strict JSON schema already forbids, so they could only
// ever read 100%. Six columns pinned at 100% do not make a table more rigorous;
// they bury the two columns that can move. They survive here collapsed into one
// alarm, which is what they always were.
//
// The unit is a headword, because that is the unit the label is written at, so
// each scorer averages across the headword's per-meaning calls.
//
// Every scorer returns a NAMED score even when it declines to score. A bare
// `null` carries no name, so Braintrust falls back to the function's identifier
// and silently opens a second column — which is exactly what `ContractEvidence-
// Exists` did, appearing twice as itself and as `evidenceCitationScorer`.

import type { EvalScorer } from "braintrust";

import { examLevelValues, usefulnessFindingSchema } from "../../src/usefulness/contract.ts";
import { citableEvidenceIds, evidenceItems } from "../../src/usefulness/meaning.ts";
import type { HeadwordOutcome } from "../../src/usefulness/run.ts";
import type { EvalInput, UsefulnessCase } from "../usefulness-datasets.ts";
import { meaningsOf } from "../usefulness-datasets.ts";

type Scorer = EvalScorer<EvalInput, HeadwordOutcome, UsefulnessCase["expected"]>;

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

const DISPOSITION_KEY =
  /disposition|decision|verdict|recommend|action|outcome|status|advance|exclude|quarantine|serve|reject/i;

function hasDispositionKey(value: unknown, found: string[], path = ""): void {
  const obj = asObject(value);
  if (obj) {
    for (const [key, child] of Object.entries(obj)) {
      if (DISPOSITION_KEY.test(key)) found.push(path ? `${path}.${key}` : key);
      hasDispositionKey(child, found, path ? `${path}.${key}` : key);
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((item, i) => hasDispositionKey(item, found, `${path}[${i}]`));
}

/**
 * The alarm. Everything here should be impossible.
 *
 * The strict schema forbids a malformed object, a verdict outside the enum, and
 * any key the contract does not name, and `require_parameters: true` keeps
 * OpenRouter from routing to an upstream that ignores `response_format`. So this
 * reads 1.00 unless a promise was broken somewhere — a loosened contract, a
 * provider that lied, a `strictObject` quietly turned into an `object`.
 *
 * Lifted by: nothing. If this ever moves, stop and find out why.
 */
export const contractValidScorer: Scorer = ({ output }) => {
  const problems: string[] = [];
  for (const [i, record] of output.records.entries()) {
    const parsed = usefulnessFindingSchema.safeParse(record.raw);
    if (!parsed.success) {
      problems.push(`meaning[${i}]: ${parsed.error.issues.map((x) => x.path.join(".")).join(", ")}`);
      continue;
    }
    if (!examLevelValues.includes(parsed.data.exam_level)) {
      problems.push(`meaning[${i}]: exam level outside the enum`);
    }
    const invented: string[] = [];
    hasDispositionKey(record.raw, invented);
    if (invented.length) problems.push(`meaning[${i}]: returned ${invented.join(", ")}`);
  }
  return {
    name: "ContractValid",
    score: ratio(output.records.length - problems.length, output.records.length),
    metadata: { meanings: output.records.length, problems },
  };
};

/**
 * Did each answer come back attached to the meaning it was asked about?
 *
 * Not guaranteed by the schema, which can require a string but not require it to
 * be the right one. A well-formed finding on the wrong sense scores as a valid
 * judgment unless something checks, and the per-meaning fan-out gives it more
 * chances to go wrong than morphology had.
 *
 * Lifted by: nothing in the prompt. A failure here is a bug in the runner.
 */
export const meaningIdentityScorer: Scorer = ({ input, output }) => {
  const asked = meaningsOf(input).map((m) => m.meaning.sense_id);
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
 *
 * Lifted by: a repair retry, if one is ever added. Today nothing is repaired, so
 * this measures raw first-attempt compliance.
 */
export const meaningCoverageScorer: Scorer = ({ input, output }) => {
  const expected = meaningsOf(input).length;
  const judged = output.records.filter((record) => record.finding !== null).length;
  return {
    name: "ContractMeaningCoverage",
    score: ratio(judged, expected),
    metadata: { meanings: expected, judged, contract_failures: output.contractFailures },
  };
};

/**
 * Did the judge cite evidence labels that exist?
 *
 * Meaningful only since `usefulness-finding/2`. Under version 1 the sense id was
 * the sole citable identifier, so this scored a model for saying less: `Texan`
 * scored 100% by echoing one id while `pinnate` scored 0% for naming the three
 * things it actually reasoned from. Now every evidence item carries a label, so
 * a citation is both possible and checkable — and the metadata records which
 * KINDS of evidence carried the verdict, which is the open question behind the
 * `happy` failure.
 *
 * Lifted by: the contract description, and the prompt's citation rule.
 */
export const evidenceCitedScorer: Scorer = ({ input, output }) => {
  const meanings = meaningsOf(input);
  let cited = 0;
  const invented: string[] = [];
  const kinds: Record<string, number> = {};

  output.records.forEach((record, i) => {
    const subject = meanings[i];
    if (!subject) return;
    const legal = citableEvidenceIds(subject);
    const byId = new Map(evidenceItems(subject).map((item) => [item.id, item.kind]));
    for (const id of strings(asObject(record.raw)?.evidence_ids)) {
      cited += 1;
      if (!legal.has(id)) {
        invented.push(id);
        continue;
      }
      const kind = byId.get(id)!;
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
  });

  // Declining to score, but by name: a bare null opens a phantom column.
  if (cited === 0) {
    return { name: "ContractEvidenceCited", score: null, metadata: { reason: "nothing cited" } };
  }
  return {
    name: "ContractEvidenceCited",
    score: ratio(cited - invented.length, cited),
    metadata: { cited, invented: [...new Set(invented)], cited_kinds: kinds },
  };
};

export const usefulnessContractScorers = [
  contractValidScorer,
  meaningIdentityScorer,
  meaningCoverageScorer,
  evidenceCitedScorer,
];
