// Runs the usefulness golden set outside Braintrust.
//
// Two jobs the eval harness does not do: it exercises the persistence path (so a
// second run of an unchanged configuration costs nothing), and it refuses to
// start when the estimate would breach the pilot cap. Run it before
// `npm run eval:usefulness` so the first paid call is a deliberate one.
//
//   npm run usefulness            # 19 meanings across 12 headwords, or reuse
//   npm run usefulness -- --dry   # estimate and budget only, no calls

import { createClient } from "./adjudicate.ts";
import { describeBudget, preflight, spentSoFar } from "./budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "./config.ts";
import { RunStore } from "./store.ts";
import { usefulnessGate } from "./usefulness/gate.ts";
import { judgeHeadword } from "./usefulness/run.ts";
import { loadUsefulnessDataset } from "../evals/usefulness-datasets.ts";

const CASE_SET = process.env.CASE_SET ?? "usefulness-golden-v2";
const RUNS_DIR = "runs";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = modelConfigFromEnv();

  const dataset = loadUsefulnessDataset(CASE_SET);
  const meanings = dataset.cases.flatMap(({ group }) => group.meanings);
  const { price, check } = await preflight(meanings, usefulnessGate, model, apiKey);

  console.log(
    `${dataset.cases.length} headwords, ${meanings.length} meanings in ${CASE_SET} (${dataset.setVersion})`,
  );
  console.log(`prompt ${usefulnessGate.versions.prompt}, rubric ${usefulnessGate.versions.rubric}`);
  console.log(describeBudget(check, model, PILOT_BUDGET_USD));
  console.log(
    `prices used: $${price.prompt} per prompt token, $${price.completion} per completion token\n`,
  );

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

  let agreed = 0;
  let failures = 0;
  const misses: string[] = [];

  for (const { group, expected } of dataset.cases) {
    const outcome = await judgeHeadword(group, client, model, dataset.manifest, store);
    failures += outcome.contractFailures;

    const correct = outcome.decision.disposition === expected.disposition;
    if (correct) agreed += 1;
    else misses.push(`${group.display} (${expected.bucket}) -> ${outcome.decision.disposition}`);

    const mark = correct ? "  " : "！";
    const cost = outcome.records.reduce((total, r) => total + (r.usage.cost_usd ?? 0), 0);
    console.log(
      `${mark}${group.display.padEnd(14)} ${outcome.decision.disposition.padEnd(10)} expected ${expected.disposition.padEnd(10)} [${expected.reason}]`,
    );
    for (const record of outcome.records) {
      const verdict = record.finding
        ? `${record.finding.usefulness}: ${record.finding.rationale}`
        : `CONTRACT FAILURE: ${record.contract_error}`;
      console.log(`    ${record.claim_id.split("|")[1]}  ${verdict}`);
    }
    console.log(`    ${outcome.reusedCount}/${outcome.records.length} reused, $${cost.toFixed(6)}\n`);
  }

  console.log(`headword dispositions matching the bucket: ${agreed}/${dataset.cases.length}`);
  for (const miss of misses) console.log(`  miss: ${miss}`);
  console.log(`contract failures: ${failures}/${meanings.length} meanings`);
  console.log(`total recorded spend: $${spentSoFar(RUNS_DIR).toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
