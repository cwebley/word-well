import type OpenAI from "openai";
import { z } from "zod";

import {
  loadUnlabelledSet,
  loadUsefulnessDataset,
  usefulnessCaseSetRole,
} from "../evals/usefulness-datasets.ts";
import { adjudicate, createClient } from "./adjudicate.ts";
import { describeBudget, preflight, spentSoFar } from "./budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "./config.ts";
import type { EvidenceManifest, ModelConfig } from "./fingerprint.ts";
import { buildFingerprint } from "./fingerprint.ts";
import type { Gate } from "./gate.ts";
import { parseFinding } from "./parse.ts";
import { RunStore } from "./store.ts";
import {
  buildHeadwordSubject,
  renderWordLevelSubject,
  V13_RUBRIC,
  V14_RUBRIC,
  wordLevelFindingSchema,
  wordLevelVerdict,
  type HeadwordSubject,
  type WordLevelFinding,
} from "./usefulness/word-level-v13.ts";

const CASE_SET = process.env.CASE_SET ?? "usefulness-golden-v3";
const RUNS_DIR = "runs";
const PROMPT_NUMBER = process.env.PROMPT_NUMBER ?? "13";
if (PROMPT_NUMBER !== "13" && PROMPT_NUMBER !== "14") {
  throw new Error(`unsupported headword teaching-value prompt: ${PROMPT_NUMBER}`);
}
const RUBRIC = PROMPT_NUMBER === "14" ? V14_RUBRIC : V13_RUBRIC;
const VERSIONS = {
  prompt: `usefulness-prompt/${PROMPT_NUMBER}`,
  rubric: PROMPT_NUMBER === "14" ? "usefulness-rubric/12" : "usefulness-rubric/11",
  contract: "usefulness-finding/5",
  policy: "usefulness-policy/4",
} as const;

const wordLevelGate: Gate<HeadwordSubject, WordLevelFinding> = {
  name: "audience-usefulness",
  versions: VERSIONS,
  jsonSchema: z.toJSONSchema(wordLevelFindingSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>,
  subjectId: (subject) => subject.subject_id,
  inputDigest: (subject) => subject.input_digest,
  buildMessages: (subject) => [
    { role: "system", content: RUBRIC },
    { role: "user", content: renderWordLevelSubject(subject) },
  ],
  parse: (content, subject) =>
    parseFinding(
      content,
      wordLevelFindingSchema,
      subject.normalized,
      (finding) => finding.headword.toLowerCase(),
      VERSIONS.contract,
    ),
  decide: (finding) => {
    const verdict = wordLevelVerdict(finding);
    if (verdict === "useful") {
      return { disposition: "advance", reason: "the headword rewards deliberate study" };
    }
    if (verdict === "not_useful") {
      return { disposition: "exclude", reason: "the headword does not reward deliberate study" };
    }
    return { disposition: "quarantine", reason: "the model does not know the headword well enough" };
  },
  policyContext: (subject) => ({ endorsements: subject.policy_context.endorsements }),
};

async function judge(
  subject: HeadwordSubject,
  client: OpenAI,
  model: ModelConfig,
  manifest: EvidenceManifest,
  store: RunStore,
) {
  return adjudicate(subject, wordLevelGate, client, model, manifest, store);
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const isLabelled = usefulnessCaseSetRole(CASE_SET) === "labelled";
  const labelled = isLabelled ? loadUsefulnessDataset(CASE_SET) : undefined;
  const unlabelled = isLabelled ? undefined : loadUnlabelledSet(CASE_SET);
  const groups = labelled?.cases.map((entry) => entry.group) ?? unlabelled!.groups;
  const subjects = groups.map(buildHeadwordSubject);
  const sourceManifest = labelled?.manifest ?? unlabelled!.manifest;
  const manifest: EvidenceManifest = {
    ...sourceManifest,
    extraction_version: "usefulness-headword-evidence/1",
    claims: Object.fromEntries(subjects.map((subject) => [subject.subject_id, subject.input_digest])),
  };
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = modelConfigFromEnv();
  const store = new RunStore(RUNS_DIR);
  const unpaid = subjects.filter(
    (subject) => !store.get(buildFingerprint(subject.input_digest, manifest, model, VERSIONS)),
  );
  const { check } = await preflight(unpaid, wordLevelGate, model, apiKey);

  console.log(`${CASE_SET}: ${subjects.length} headwords, one call per headword`);
  console.log(`${VERSIONS.prompt}, ${VERSIONS.rubric}, headword and parts of speech only`);
  console.log(`${unpaid.length} new calls, ${subjects.length - unpaid.length} reusable records`);
  console.log(describeBudget(check, model, PILOT_BUDGET_USD));
  if (!check.allowed) throw new Error("estimate exceeds remaining pilot budget");
  if (dryRun) {
    console.log("--dry: no calls made");
    return;
  }

  const client = createClient(apiKey);
  let kept = 0;
  let rejected = 0;
  let quarantined = 0;
  let reused = 0;
  let correct = 0;
  const misses: string[] = [];

  for (const subject of subjects) {
    const outcome = await judge(subject, client, model, manifest, store);
    if (outcome.reused) reused += 1;
    const disposition = outcome.record.effective?.disposition ?? "quarantine";
    if (disposition === "advance") kept += 1;
    else if (disposition === "exclude") rejected += 1;
    else quarantined += 1;

    const expected = labelled?.cases.find((entry) => entry.group.headword === subject.normalized)?.expected;
    if (expected) {
      if (expected.disposition === disposition) correct += 1;
      else misses.push(`${subject.display} (${expected.bucket}) -> ${disposition}`);
    }
    console.log(`${subject.display.padEnd(18)} ${disposition}`);
  }

  console.log(`\nkept ${kept}/${subjects.length}, rejected ${rejected}, quarantined ${quarantined}`);
  if (labelled) {
    console.log(`headword dispositions matching the bucket: ${correct}/${subjects.length}`);
    for (const miss of misses) console.log(`  miss: ${miss}`);
  }
  console.log(`${reused}/${subjects.length} records reused`);
  console.log(`total recorded spend: $${spentSoFar(RUNS_DIR).toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
