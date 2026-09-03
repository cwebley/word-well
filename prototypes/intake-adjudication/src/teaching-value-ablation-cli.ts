import type OpenAI from "openai";
import { z } from "zod";

import { loadUnlabelledSet, loadUsefulnessDataset } from "../evals/usefulness-datasets.ts";
import { adjudicate, createClient } from "./adjudicate.ts";
import { describeBudget, preflight, spentSoFar } from "./budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "./config.ts";
import type { Disposition } from "./disposition.ts";
import { buildFingerprint, type EvidenceManifest, type ModelConfig } from "./fingerprint.ts";
import type { Gate } from "./gate.ts";
import { parseFinding } from "./parse.ts";
import type { AdjudicationRecord } from "./store.ts";
import { RunStore } from "./store.ts";
import type { CandidateMeaning } from "./usefulness/meaning.ts";
import type { HeadwordGroup } from "./usefulness/run.ts";
import {
  renderTeachingValueSubject,
  teachingValueFindingSchema,
  teachingValueVerdict,
  type TeachingValueFinding,
  V10_RUBRIC,
} from "./usefulness/teaching-value-v10.ts";

const CASE_SET = process.env.CASE_SET ?? "usefulness-golden-v3";
const RUNS_DIR = "runs";
const PROMPT_NUMBER = process.env.PROMPT_NUMBER ?? "11";
if (PROMPT_NUMBER !== "11" && PROMPT_NUMBER !== "12") {
  throw new Error(`unsupported teaching-value ablation prompt: ${PROMPT_NUMBER}`);
}
const OMIT_DEFINITION = PROMPT_NUMBER === "12";
const PROMPT_VERSION = `usefulness-prompt/${PROMPT_NUMBER}`;
const RUBRIC_VERSION = "usefulness-rubric/10";
const CONTRACT_VERSION = "usefulness-finding/4";
const POLICY_VERSION = "usefulness-policy/3";

const experimentGate: Gate<CandidateMeaning, TeachingValueFinding> = {
  name: "audience-usefulness",
  versions: {
    prompt: PROMPT_VERSION,
    rubric: RUBRIC_VERSION,
    contract: CONTRACT_VERSION,
    policy: POLICY_VERSION,
  },
  jsonSchema: z.toJSONSchema(teachingValueFindingSchema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>,
  subjectId: (subject) => subject.subject_id,
  inputDigest: (subject) => subject.input_digest,
  buildMessages: (subject) => [
    { role: "system", content: V10_RUBRIC },
    {
      role: "user",
      content: renderTeachingValueSubject(subject, {
        includeDefinition: !OMIT_DEFINITION,
        includeSynonyms: false,
      }),
    },
  ],
  parse: (content, subject) =>
    parseFinding(
      content,
      teachingValueFindingSchema,
      subject.meaning.sense_id,
      (finding) => finding.sense_id,
      CONTRACT_VERSION,
    ),
  decide: (finding) => {
    const verdict = teachingValueVerdict(finding);
    if (verdict === "useful") {
      return { disposition: "advance", reason: "this meaning is worth learning for the audience" };
    }
    if (verdict === "not_useful") {
      return { disposition: "exclude", reason: "this meaning is not worth learning for the audience" };
    }
    return {
      disposition: "quarantine",
      reason: "the evidence cannot settle whether this meaning is worth learning",
    };
  },
  policyContext: (subject) => ({ endorsements: subject.policy_context.endorsements }),
};

function fold(records: AdjudicationRecord<TeachingValueFinding>[]): Disposition {
  const decisions = records.map((record) => record.decision?.disposition);
  if (decisions.includes("advance")) return "advance";
  if (decisions.includes("quarantine") || decisions.includes(undefined)) return "quarantine";
  return "exclude";
}

async function judgeGroup(
  group: HeadwordGroup,
  client: OpenAI,
  model: ModelConfig,
  manifest: EvidenceManifest,
  store: RunStore,
) {
  const records: AdjudicationRecord<TeachingValueFinding>[] = [];
  let reused = 0;
  for (const meaning of group.meanings) {
    const result = await adjudicate(meaning, experimentGate, client, model, manifest, store);
    records.push(result.record);
    if (result.reused) reused += 1;
  }
  return { records, disposition: fold(records), reused };
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const isGolden = CASE_SET.startsWith("usefulness-golden-");
  const labelled = isGolden ? loadUsefulnessDataset(CASE_SET) : undefined;
  const unlabelled = isGolden ? undefined : loadUnlabelledSet(CASE_SET);
  const groups = labelled?.cases.map((entry) => entry.group) ?? unlabelled!.groups;
  const meanings = groups.flatMap((group) => group.meanings);
  const manifest = labelled?.manifest ?? unlabelled!.manifest;
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const model = modelConfigFromEnv();
  const store = new RunStore(RUNS_DIR);
  const unpaidMeanings = meanings.filter(
    (meaning) => !store.get(buildFingerprint(meaning.input_digest, manifest, model, experimentGate.versions)),
  );
  const { check } = await preflight(unpaidMeanings, experimentGate, model, apiKey);

  console.log(`${CASE_SET}: ${groups.length} headwords, ${meanings.length} meanings`);
  console.log(
    `${PROMPT_VERSION}, ${RUBRIC_VERSION}, synonyms omitted` +
      (OMIT_DEFINITION ? ", definitions omitted" : ""),
  );
  console.log(`${unpaidMeanings.length} new calls, ${meanings.length - unpaidMeanings.length} reusable records`);
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

  for (const group of groups) {
    const outcome = await judgeGroup(group, client, model, manifest, store);
    reused += outcome.reused;
    if (outcome.disposition === "advance") kept += 1;
    else if (outcome.disposition === "exclude") rejected += 1;
    else quarantined += 1;

    const expected = labelled?.cases.find((entry) => entry.group.headword === group.headword)?.expected;
    if (expected) {
      if (expected.disposition === outcome.disposition) correct += 1;
      else misses.push(`${group.display} (${expected.bucket}) -> ${outcome.disposition}`);
    }
    console.log(`${group.display.padEnd(18)} ${outcome.disposition}`);
  }

  console.log(`\nkept ${kept}/${groups.length}, rejected ${rejected}, quarantined ${quarantined}`);
  if (labelled) {
    console.log(`headword dispositions matching the bucket: ${correct}/${groups.length}`);
    for (const miss of misses) console.log(`  miss: ${miss}`);
  }
  console.log(`${reused}/${meanings.length} records reused`);
  console.log(`total recorded spend: $${spentSoFar(RUNS_DIR).toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
