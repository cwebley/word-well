// Maps experiment/case/trial identity to one saved attempt and runs it through
// the shared executor. A new experiment gets fresh attempts; resume reuses the
// recorded attempt, so a saved outcome (including a failure) is returned as is.
import { randomUUID } from "node:crypto";
import type { ExecutionOutcome, StageExecutor } from "../pipeline/execution/executor.js";
import type { StageDefinition } from "../pipeline/execution/stage.js";
import { resultSchema } from "../pipeline/stages/appropriateness.js";
import type { AttemptRecord, PrivateStore } from "../pipeline/storage/postgres.js";
import type { TrialOutcome } from "./scorers/appropriateness.js";

export async function runTrial<Input, Result>(options: {
  store: PrivateStore; executor: StageExecutor; stage: StageDefinition<Input, Result>;
  experimentId: string; caseId: string; trialIndex: number; input: Input;
}): Promise<{ outcome: ExecutionOutcome<Result>; previouslySaved: boolean }> {
  const attemptId = await options.store.trialAttempt(options.experimentId, options.caseId, options.trialIndex, randomUUID());
  const prior = await options.store.readAttempt(attemptId);
  const outcome = await options.executor.execute({ experimentId: options.experimentId, attemptId, stage: options.stage, input: options.input });
  return { outcome, previouslySaved: prior !== null && prior.status !== "pending" };
}

// Terminal outcomes score; a paused attempt is not finished and stays missing.
export function trialOutcome(outcome: ExecutionOutcome<{ blockedProbability: number; slurProbability?: number | null; vulgarProbability?: number | null }>): TrialOutcome | null {
  switch (outcome.state) {
    case "valid": return { state: "valid", blockedProbability: outcome.result.blockedProbability,
      slurProbability: outcome.result.slurProbability ?? null, vulgarProbability: outcome.result.vulgarProbability ?? null };
    case "paused": return null;
    default: return { state: outcome.state };
  }
}

// The scorer's view of a saved attempt; a pending attempt has no outcome yet.
export function outcomeFromAttempt(attempt: AttemptRecord): TrialOutcome | null {
  if (attempt.status === "pending") return null;
  if (attempt.status !== "valid") return { state: attempt.status };
  const result = resultSchema.parse(attempt.result);
  return { state: "valid", blockedProbability: result.blockedProbability,
    slurProbability: result.slurProbability ?? null, vulgarProbability: result.vulgarProbability ?? null };
}
