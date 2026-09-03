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

import { writeFileSync } from "node:fs";

import { adjudicate, createClient } from "./adjudicate.ts";
import { describeBudget, preflight, spentSoFar } from "./budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "./config.ts";
import { morphologyGate, summariseFinding } from "./morphology/gate.ts";
import { RunStore, summarise } from "./store.ts";
import { loadDataset, loadReviewClaims } from "../evals/datasets.ts";
import type { Finding } from "./morphology/contract.ts";
import type { AdjudicationRecord } from "./store.ts";

const CASE_SET = process.env.CASE_SET ?? "contract-test";
const RUNS_DIR = "runs";

async function main() {
  const dryRun = process.argv.includes("--dry");
  const fresh = process.argv.includes("--fresh");
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = modelConfigFromEnv();

  const review = CASE_SET === "calibration-review" ? loadReviewClaims() : null;
  const dataset = review ? null : loadDataset(CASE_SET);
  const claims = review?.claims ?? dataset!.cases.map(({ claim }) => claim);
  const manifest = review?.manifest ?? dataset!.manifest;
  const { price, check } = await preflight(claims, morphologyGate, model, apiKey);

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
  const records: AdjudicationRecord<Finding>[] = [];
  for (const claim of claims) {
    const { record, reused } = await adjudicate(claim, morphologyGate, client, model, manifest, store);
    records.push(record);
    if (record.contract_error) failures += 1;
    console.log(`${reused ? "reused " : "called "}${summarise(record, summariseFinding)}\n`);
  }

  if (review) {
    const members = new Map(review.members.map((member) => [member.claim_id, member]));
    const labels = records
      .filter((record) => record.finding && record.decision && record.effective)
      .map((record) => {
        const member = members.get(record.claim_id)!;
        return {
          claim_id: record.claim_id,
          label_status: "provisional-unvalidated",
          slice: "provisional model suggestion",
          analysis_support: record.finding!.analysis_support,
          meanings: record.finding!.meanings,
          morphology_disposition: record.decision!.disposition,
          effective_disposition: record.effective!.disposition,
          endorsements: record.policy_context.endorsements,
          note: record.finding!.meanings.map((meaning) => meaning.rationale).join(" "),
          input_digest: member.input_digest,
          partition: member.partition,
          proposed_at: record.recorded_at,
          proposal_fingerprint: record.fingerprint_key,
        };
      })
      .sort((left, right) => left.claim_id.localeCompare(right.claim_id));
    writeFileSync(
      "labels/calibration-silver.provisional.jsonl",
      `${labels.map((label) => JSON.stringify(label)).join("\n")}\n`,
    );
    console.log(`wrote ${labels.length} provisional labels for local review`);
  }

  const after = spentSoFar(RUNS_DIR);
  console.log(`contract failures: ${failures}/${claims.length}`);
  console.log(`total recorded spend: $${after.toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
