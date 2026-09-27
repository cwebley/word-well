// Runs the usefulness gate over an eval set and scores it. Cases run one at a
// time so a live failure stops before any further calls are made.
import { JevError, type JevClient, type JevErrorKind } from "../pipeline/execution/jev.js";
import { judgeUsefulness, type Combiner } from "../pipeline/stages/usefulness.js";
import type { UsefulnessCase } from "./datasets/usefulness.js";
import { scoreUsefulness, type ScoredRow, type UsefulnessReport } from "./scorers/usefulness.js";

export type UsefulnessRun = {
  rows: ScoredRow[];
  report: UsefulnessReport;
  error: { kind: JevErrorKind; message: string; headword: string } | null;
};

export async function runUsefulnessEval({ cases, combiner, jev }: {
  cases: UsefulnessCase[];
  combiner: Combiner;
  jev: JevClient;
}): Promise<UsefulnessRun> {
  const rows: ScoredRow[] = [];
  let error: UsefulnessRun["error"] = null;
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
      // A replay gap costs nothing and says nothing about Jev; anything else stops the run.
      if (e.kind !== "not_saved") error = { kind: e.kind, message: e.message, headword: c.headword };
    }
  }
  return { rows, report: scoreUsefulness(rows), error };
}
