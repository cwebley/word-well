// Runs the contract-test case set outside Braintrust.
//
// Two jobs the eval harness does not do: it exercises the persistence path (so
// a second run of an unchanged configuration costs nothing), and it refuses to
// start when the estimate would breach the pilot cap. Run it before `npm run
// eval` so the first paid call is a deliberate one.
//
//   npm run adjudicate            # five cases, or reuse if already recorded
//   npm run adjudicate -- --dry   # estimate and budget only, no calls
//   npm run adjudicate -- --fresh # ignore the store: pay again, store nothing
//
// --fresh exists because persistence and reliability measurement want opposite
// things. Persistence answers "have we paid for this already"; a reliability
// probe needs to ask the same question twice and see whether the answer holds.
// Reusing a record there would manufacture perfect agreement.

import { join } from "node:path";

import { readClaims } from "./claim.ts";
import { adjudicate, createClient } from "./adjudicate.ts";
import { checkBudget, describeBudget, estimateCost, fetchPrice, spentSoFar } from "./budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "./config.ts";
import { readManifest } from "./fingerprint.ts";
import { RunStore, summarise } from "./store.ts";

const CASE_SET = process.env.CASE_SET ?? "contract-test";
const EVIDENCE_DIR = "evidence";
const RUNS_DIR = "runs";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const fresh = process.argv.includes("--fresh");
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = modelConfigFromEnv();

  const claims = readClaims(join(EVIDENCE_DIR, `${CASE_SET}.claims.jsonl`));
  const manifest = readManifest(join(EVIDENCE_DIR, `${CASE_SET}.manifest.json`));

  const price = await fetchPrice(model.model, apiKey);
  const check = checkBudget(
    spentSoFar(RUNS_DIR),
    estimateCost(claims, price),
    PILOT_BUDGET_USD,
  );

  console.log(`${claims.length} claims in ${CASE_SET}`);
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
  // No store on a fresh run: nothing is read, and nothing is written that would
  // collide with the recorded run under the same fingerprint.
  const store = fresh ? undefined : new RunStore(RUNS_DIR);
  if (fresh) console.log("--fresh: ignoring persisted records, storing nothing\n");

  let failures = 0;
  for (const claim of claims) {
    const { record, reused } = await adjudicate(claim, client, model, manifest, store);
    if (record.contract_error) failures += 1;
    console.log(`${reused ? "reused " : "called "}${summarise(record, claim)}\n`);
  }

  const after = spentSoFar(RUNS_DIR);
  console.log(`contract failures: ${failures}/${claims.length}`);
  console.log(`total recorded spend: $${after.toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
