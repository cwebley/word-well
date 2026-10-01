// Runs the usefulness gate over an eval set and scores it. Cases run one at a
// time so a run-stopping failure stops before any further calls are made.
import { JevError, type JevClient, type JevErrorKind } from "../pipeline/execution/jev.js";
import { judgeUsefulness, type Combiner } from "../pipeline/stages/usefulness.js";
import type { UsefulnessCase } from "./datasets/usefulness.js";
import { scoreUsefulness, type ScoredRow, type UsefulnessReport } from "./scorers/usefulness.js";

export type Failure = { kind: JevErrorKind; message: string; headword: string };

export type UsefulnessRun = {
  rows: ScoredRow[];
  report: UsefulnessReport;
  // Words left incomplete by a one-word failure, with the reason.
  failures: Failure[];
  // The failure that stopped the run, if any.
  error: Failure | null;
};

// A bad reply for one word marks only that word incomplete. Failures that
// would repeat on every call (HTTP, lost connection, cap, wrong model) stop
// the run at once, and so does a third bad reply.
const MAX_INVALID = 3;

export async function runUsefulnessEval({ cases, combiner, jev }: {
  cases: UsefulnessCase[];
  combiner: Combiner;
  jev: JevClient;
}): Promise<UsefulnessRun> {
  const rows: ScoredRow[] = [];
  const failures: Failure[] = [];
  let error: Failure | null = null;
  for (const c of cases) {
    if (error) {
      rows.push({ case: c, result: null });
      continue;
    }
    try {
      rows.push({ case: c, result: await judgeUsefulness({ headword: c.headword, partsOfSpeech: c.partsOfSpeech }, combiner, jev) });
    } catch (e) {
      if (!(e instanceof JevError)) throw e;
      rows.push({ case: c, result: null });
      const failure = { kind: e.kind, message: e.message, headword: c.headword };
      if (e.kind === "not_saved") continue;
      if (e.kind === "invalid") {
        failures.push(failure);
        if (failures.filter((f) => f.kind === "invalid").length < MAX_INVALID) continue;
      }
      error = failure;
    }
  }
  return { rows, report: scoreUsefulness(rows), failures, error };
}
