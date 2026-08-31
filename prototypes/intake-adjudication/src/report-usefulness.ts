// Reads a completed run out of `runs/` and prints the decision table.
//
// This exists because Braintrust is the wrong tool for one question. It earns
// its place comparing experiments — v1 against v2, model A against model B,
// filtered by slice. For "what did it decide on twelve rows" a terminal table
// wins, and always will.
//
// Makes no model calls and needs no credentials: everything it prints is
// already on disk under the fingerprint the run was keyed by.
//
//   npm run report                      # the golden set
//   CASE_SET=retention-audit-v1 npm run report

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { RUNS_DIR } from "./config.ts";
import type { UsefulnessFinding } from "./usefulness/contract.ts";
import { deriveHeadwordDisposition } from "./usefulness/policy.ts";
import type { AdjudicationRecord } from "./store.ts";
import { loadUsefulnessDataset } from "../evals/usefulness-datasets.ts";

const CASE_SET = process.env.CASE_SET ?? "usefulness-golden-v1";

const MARK: Record<string, string> = { useful: "+", not_useful: "−", insufficient_evidence: "?" };

function loadRecords(): Map<string, AdjudicationRecord<UsefulnessFinding>> {
  const records = new Map<string, AdjudicationRecord<UsefulnessFinding>>();
  for (const name of readdirSync(RUNS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(
      readFileSync(join(RUNS_DIR, name), "utf-8"),
    ) as AdjudicationRecord<UsefulnessFinding>;
    if (record.gate !== "audience-usefulness") continue;
    // Several runs of the same subject can coexist under different
    // fingerprints. The newest wins, so the table reflects the latest run.
    const existing = records.get(record.claim_id);
    if (!existing || record.recorded_at > existing.recorded_at) {
      records.set(record.claim_id, record);
    }
  }
  return records;
}

function main() {
  const dataset = loadUsefulnessDataset(CASE_SET);
  const records = loadRecords();

  console.log(`${CASE_SET} (${dataset.setVersion})\n`);
  console.log("word          label   gate       ok  senses  verdicts");
  console.log("─".repeat(72));

  let agreed = 0;
  let missing = 0;
  const misses: string[] = [];

  for (const { group, expected } of dataset.cases) {
    const found = group.meanings.map((m) => records.get(m.subject_id));
    if (found.some((r) => r === undefined)) {
      missing += 1;
      console.log(`${group.display.padEnd(13)} ${expected.bucket.padEnd(7)} (not run under the current configuration)`);
      continue;
    }
    const verdicts = found.map((r) => r!.finding?.usefulness).filter((v) => v !== undefined);
    const decision = deriveHeadwordDisposition(verdicts);
    const hit = decision.disposition === expected.disposition;
    if (hit) agreed += 1;
    else misses.push(`${group.display} (${expected.bucket}, ${expected.reason}) -> ${decision.disposition}`);

    console.log(
      [
        group.display.padEnd(13),
        expected.bucket.padEnd(7),
        decision.disposition.padEnd(10),
        (hit ? " ✓" : " ✗").padEnd(3),
        String(group.meanings.length).padEnd(7),
        found.map((r) => MARK[r!.finding?.usefulness ?? ""] ?? "!").join(" "),
      ].join(" "),
    );
  }

  console.log("─".repeat(72));
  const scored = dataset.cases.length - missing;
  console.log(`${agreed}/${scored} matched the label   (+ useful, − not_useful, ? undecided, ! no finding)`);
  for (const miss of misses) console.log(`  miss: ${miss}`);
  if (missing) console.log(`\n${missing} headwords have no record for this configuration; run npm run usefulness`);

  const used = dataset.cases.flatMap(({ group }) =>
    group.meanings.map((m) => records.get(m.subject_id)).filter((r) => r !== undefined),
  );
  const spend = used.reduce((total, r) => total + (r!.usage.cost_usd ?? 0), 0);
  const fingerprints = new Set(used.map((r) => r!.fingerprint.prompt_version + " / " + r!.fingerprint.model));
  console.log(`\n${used.length} calls, $${spend.toFixed(6)} when first paid for`);
  for (const fingerprint of fingerprints) console.log(`  ${fingerprint}`);
}

main();
