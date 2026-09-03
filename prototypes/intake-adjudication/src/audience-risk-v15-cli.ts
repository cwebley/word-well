import { readFileSync } from "node:fs";

import type OpenAI from "openai";
import { z } from "zod";

import { adjudicate, createClient } from "./adjudicate.ts";
import { describeBudget, preflight, spentSoFar } from "./budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "./config.ts";
import type { EvidenceManifest, ModelConfig } from "./fingerprint.ts";
import { buildFingerprint } from "./fingerprint.ts";
import type { Gate } from "./gate.ts";
import { parseFinding } from "./parse.ts";
import { RunStore } from "./store.ts";
import {
  audienceRiskFindingSchema,
  audienceRiskDisposition,
  buildSubjectFromCohort,
  loadPerSenseEvidence,
  renderAudienceRiskSubject,
  V15_RUBRIC,
  type AudienceRiskFinding,
  type AudienceRiskSubject,
} from "./audience-risk-v15.ts";

const CASE_SET = process.env.CASE_SET ?? "risk-cohort-v1";
const RUNS_DIR = "runs";
const PER_SENSE_PATH = "evidence/risk-per-sense.jsonl";
const VERSIONS = {
  prompt: "usefulness-prompt/15",
  rubric: "usefulness-rubric/13",
  contract: "usefulness-finding/6",
  policy: "usefulness-policy/6",
};

interface CohortRecord {
  lemma: string;
  display: string;
  cohort: "at-risk" | "control" | "v14-keep";
  wik_first: string | null;
  wik_labels: string | null;
  f_informal: boolean;
  endorsements: number;
  zipf_summed: number;
}

function loadCohort(path: string): CohortRecord[] {
  const data = JSON.parse(readFileSync(path, "utf8")) as { records: CohortRecord[] };
  return data.records;
}

const audienceRiskGate: Gate<AudienceRiskSubject, AudienceRiskFinding> = {
  name: "audience-usefulness",
  versions: VERSIONS,
  jsonSchema: z.toJSONSchema(audienceRiskFindingSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>,
  subjectId: (subject) => subject.subject_id,
  inputDigest: (subject) => subject.input_digest,
  buildMessages: (subject) => [
    { role: "system", content: V15_RUBRIC },
    { role: "user", content: renderAudienceRiskSubject(subject) },
  ],
  parse: (content, subject) =>
    parseFinding(
      content,
      audienceRiskFindingSchema,
      subject.normalized,
      (finding) => finding.headword.toLowerCase(),
      VERSIONS.contract,
    ),
  decide: audienceRiskDisposition,
  policyContext: () => ({}),
};

async function main() {
  const dryRun = process.argv.includes("--dry");
  const records = loadCohort(`cases/${CASE_SET}.json`);
  const perSense = loadPerSenseEvidence(PER_SENSE_PATH);
  const subjects = records.map((record) => buildSubjectFromCohort(record, perSense));
  const manifest: EvidenceManifest = {
    case_set: CASE_SET,
    extraction_version: "risk-evidence/1",
    sources: {
      oewn: { release: "oewn:2025", retrieved_via: "wn 1.1.1" },
      wordfreq: { version: "3.1.1", wordlist: "large" },
      candidate_pool: { path: "pool.sqlite", sha256: "a54bb48e144d07108e6f72a0a3f2336b1d8e846e40c958522d969164cd456aa1" },
    },
    deterministic_rules: { source: "audience-risk-v15.ts", sha256: null },
    claims: Object.fromEntries(subjects.map((subject) => [subject.subject_id, subject.input_digest])),
  };
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = modelConfigFromEnv();
  const store = new RunStore(RUNS_DIR);
  const unpaid = subjects.filter(
    (subject) => !store.get(buildFingerprint(subject.input_digest, manifest, model, VERSIONS)),
  );
  const { check } = await preflight(unpaid, audienceRiskGate, model, apiKey);
  console.log(`${CASE_SET}: ${subjects.length} headwords, one call per headword`);
  console.log(
    `${VERSIONS.prompt}, ${VERSIONS.rubric}, headword + parts of speech + per-sense Wiktionary labels`,
  );
  console.log(`${unpaid.length} new calls, ${subjects.length - unpaid.length} reusable records`);
  console.log(describeBudget(check, model, PILOT_BUDGET_USD));
  if (!check.allowed) throw new Error("estimate exceeds remaining pilot budget");
  if (dryRun) {
    console.log("--dry: no calls made");
    return;
  }

  const client = createClient(apiKey);
  let kept = 0;
  let quarantined = 0;
  let rejected = 0;
  let reused = 0;
  const misses: string[] = [];

  for (const subject of subjects) {
    const outcome = await adjudicate(subject, audienceRiskGate, client, model, manifest, store);
    if (outcome.reused) reused += 1;
    const disposition = outcome.record.effective?.disposition ?? "quarantine";
    if (disposition === "advance") kept += 1;
    else if (disposition === "exclude") rejected += 1;
    else quarantined += 1;
    console.log(
      `${subject.display.padEnd(20)} ${subject.cohort.padEnd(10)} ${disposition}`,
    );
  }

  console.log(
    `\nkept ${kept}/${subjects.length}, rejected ${rejected}, quarantined ${quarantined}`,
  );
  console.log(`${reused}/${subjects.length} records reused`);
  console.log(`total recorded spend: $${spentSoFar(RUNS_DIR).toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
