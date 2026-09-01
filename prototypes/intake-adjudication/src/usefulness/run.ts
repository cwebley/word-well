// Judging one headword: fan out per meaning, then fold.
//
// Shared by the CLI and the Braintrust eval for the same reason `adjudicate` is
// shared — if the two grouped or folded differently, an experiment would be
// measuring something the CLI never runs.
//
// The fan-out is what stage 2 bought us. Each meaning is its own paid call with
// its own fingerprint, so a rationale cannot be written about the easy member of
// a group and then asserted over the hard one, and a persisted meaning is reused
// even when a sibling has to be paid for again.

import type OpenAI from "openai";

import { adjudicate } from "../adjudicate.ts";
import type { DispositionResult } from "../disposition.ts";
import type { EvidenceManifest, ModelConfig } from "../fingerprint.ts";
import type { AdjudicationRecord, RunStore } from "../store.ts";
import type { UsefulnessFinding } from "./contract.ts";
import { usefulnessGate } from "./gate.ts";
import type { CandidateMeaning } from "./meaning.ts";
import { deriveHeadwordDisposition } from "./policy.ts";
import { verdictOf } from "./policy.ts";

export interface HeadwordGroup {
  headword: string;
  display: string;
  meanings: CandidateMeaning[];
}

export interface HeadwordOutcome {
  headword: string;
  display: string;
  records: AdjudicationRecord<UsefulnessFinding>[];
  /** The folded headword disposition, or null when no meaning produced a finding. */
  decision: DispositionResult;
  contractFailures: number;
  reusedCount: number;
}

/** Groups a flat evidence file into the headwords policy actually decides about. */
export function groupByHeadword(meanings: CandidateMeaning[]): HeadwordGroup[] {
  const groups = new Map<string, HeadwordGroup>();
  for (const meaning of meanings) {
    const key = meaning.candidate.normalized;
    const group = groups.get(key) ?? {
      headword: key,
      display: meaning.candidate.display,
      meanings: [],
    };
    group.meanings.push(meaning);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.meanings.sort((a, b) => a.meaning.sense_id.localeCompare(b.meaning.sense_id));
  }
  return [...groups.values()].sort((a, b) => a.headword.localeCompare(b.headword));
}

export async function judgeHeadword(
  group: HeadwordGroup,
  client: OpenAI,
  model: ModelConfig,
  manifest: EvidenceManifest,
  store?: RunStore,
  runsDir?: string,
): Promise<HeadwordOutcome> {
  const records: AdjudicationRecord<UsefulnessFinding>[] = [];
  let reusedCount = 0;

  for (const meaning of group.meanings) {
    const { record, reused } = await adjudicate(
      meaning,
      usefulnessGate,
      client,
      model,
      manifest,
      store,
      runsDir,
    );
    records.push(record);
    if (reused) reusedCount += 1;
  }

  // Only meanings that produced a valid finding vote. A contract failure is not
  // silently read as `not_useful`: that would turn a broken reply into a silent
  // exclusion, which is the failure direction this gate can least afford.
  const verdicts = records
    .map((record) => (record.finding ? verdictOf(record.finding) : undefined))
    .filter((verdict): verdict is NonNullable<typeof verdict> => verdict !== undefined);

  const contractFailures = records.length - verdicts.length;
  const decision =
    contractFailures > 0 && !verdicts.includes("useful")
      ? {
          disposition: "quarantine" as const,
          reason: `${contractFailures} of ${records.length} meanings produced no valid finding`,
        }
      : deriveHeadwordDisposition(verdicts);

  return {
    headword: group.headword,
    display: group.display,
    records,
    decision,
    contractFailures,
    reusedCount,
  };
}
