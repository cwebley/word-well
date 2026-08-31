// Runs the gate over an unlabelled set and reports one number.
//
// The retention audit exists to catch unexplained movement in the share of
// editorially-endorsed words the gate keeps. It is not an accuracy measure and
// cannot be: these words carry no verdicts. A rate of 85% does not mean 85%
// correct, and neither direction of change is automatically good — a fall may
// mean the gate started dropping words editors valued, a rise may mean it went
// permissive. Both are questions.
//
// So this prints a rate and the rejections, and deliberately prints no score.
// Reading the rejections is how you learn what KIND of thing is going wrong;
// promoting them into the golden set is how you destroy the instrument, because
// the audit would then be composed of exactly the words the gate already
// handles. New cases come from a separate exploration draw.
//
//   CASE_SET=retention-audit-v1 npm run audit
//   CASE_SET=retention-audit-v1 npm run audit -- --dry

import { createClient } from "./adjudicate.ts";
import { describeBudget, preflight, spentSoFar } from "./budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "./config.ts";
import { RunStore } from "./store.ts";
import { usefulnessGate } from "./usefulness/gate.ts";
import { judgeHeadword } from "./usefulness/run.ts";
import { loadUnlabelledSet } from "../evals/usefulness-datasets.ts";

const CASE_SET = process.env.CASE_SET ?? "retention-audit-v1";
const RUNS_DIR = "runs";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = modelConfigFromEnv();

  const set = loadUnlabelledSet(CASE_SET);
  const meanings = set.groups.flatMap((group) => group.meanings);
  const { check } = await preflight(meanings, usefulnessGate, model, apiKey);

  console.log(`${CASE_SET} (${set.setVersion}) — UNLABELLED, never tuned toward`);
  console.log(`${set.groups.length} headwords, ${meanings.length} meanings`);
  if (set.promoted.length) {
    console.log(
      `NOTE: ${set.promoted.length} of these are now golden cases (${set.promoted.join(", ")}).` +
        " They are no longer independent evidence in this run.",
    );
  }
  if (set.missing.length) {
    console.log(`${set.missing.length} requested headwords have no evidence: ${set.missing.join(", ")}`);
  }
  console.log(`prompt ${usefulnessGate.versions.prompt}, contract ${usefulnessGate.versions.contract}`);
  console.log(describeBudget(check, model, PILOT_BUDGET_USD) + "\n");

  if (!check.allowed) {
    console.error("refusing to run: the estimate exceeds the remaining pilot budget");
    process.exit(1);
  }
  if (dryRun) {
    console.log("--dry: no calls made");
    return;
  }

  const client = createClient(apiKey);
  const store = new RunStore(RUNS_DIR);

  const kept: string[] = [];
  const dropped: { word: string; why: string }[] = [];
  const held: string[] = [];
  let failures = 0;
  let reused = 0;

  for (const group of set.groups) {
    const outcome = await judgeHeadword(group, client, model, set.manifest, store);
    failures += outcome.contractFailures;
    reused += outcome.reusedCount;

    if (outcome.decision.disposition === "advance") kept.push(group.display);
    else if (outcome.decision.disposition === "quarantine") held.push(group.display);
    else {
      const why = outcome.records
        .map((record) => record.finding?.rationale)
        .filter((rationale): rationale is string => rationale !== undefined)[0];
      dropped.push({ word: group.display, why: why ?? "(no rationale)" });
    }
  }

  const judged = kept.length + dropped.length + held.length;
  const rate = (kept.length / judged) * 100;

  console.log("─".repeat(72));
  console.log(`RETENTION RATE  ${rate.toFixed(1)}%   (${kept.length} kept of ${judged} endorsed words)`);
  console.log("  the frozen number: the same words, every run, comparable to the baseline");
  console.log(`  quarantined ${held.length}, excluded ${dropped.length}`);
  console.log(`  contract failures ${failures}/${meanings.length} meanings, ${reused} records reused`);
  console.log("─".repeat(72));

  if (dropped.length) {
    console.log("\nEXCLUDED — read these to learn what kind of thing is going wrong.");
    console.log("Do NOT promote them into the golden set; that consumes the audit.\n");
    for (const { word, why } of dropped) {
      console.log(`  ${word}`);
      console.log(`    ${why}`);
    }
  }
  if (held.length) console.log(`\nQUARANTINED: ${held.join(", ")}`);

  console.log(`\ntotal recorded spend: $${spentSoFar(RUNS_DIR).toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
