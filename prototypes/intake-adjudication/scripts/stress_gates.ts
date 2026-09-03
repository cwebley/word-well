// PROTOTYPE (issue #57) — stress test V14 or V15 against an unlabeled-offensive
// cohort file. Bypasses the labelled/unlabelled loader since the cohort schema
// (version + records) doesn't match either loader.
//
// Usage:
//   npx tsx scripts/stress_gates.ts --cohort cases/risk-stress-cohort-v1.json --prompt 14
//   npx tsx scripts/stress_gates.ts --cohort cases/risk-stress-cohort-v1.json --prompt 15
//
// Local-only. Writes nothing to runs/ beyond the standard adjudicate() records.

import { readFileSync } from "node:fs";
import { z } from "zod";

import { adjudicate, createClient } from "../src/adjudicate.ts";
import { describeBudget, preflight, spentSoFar } from "../src/budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "../src/config.ts";
import type { EvidenceManifest } from "../src/fingerprint.ts";
import { buildFingerprint } from "../src/fingerprint.ts";
import { RunStore } from "../src/store.ts";
import {
  audienceRiskFindingSchema,
  audienceRiskDisposition,
  audienceRiskVerdict,
  buildSubjectFromCohort,
  loadPerSenseEvidence,
  renderAudienceRiskSubject,
  V15_RUBRIC,
  type AudienceRiskFinding,
  type AudienceRiskSubject,
} from "../src/audience-risk-v15.ts";
import {
  buildHeadwordSubject,
  renderWordLevelSubject,
  V14_RUBRIC,
  wordLevelFindingSchema,
  wordLevelVerdict,
  type HeadwordSubject,
  type WordLevelFinding,
} from "../src/usefulness/word-level-v13.ts";

interface CohortRecord {
  lemma: string;
  display: string;
  cohort: string;
  pos?: string[];
  wik_first?: string | null;
  wik_labels?: string | null;
}

function parseArg(name: string): string | undefined {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return undefined;
}

const cohortPath = parseArg("--cohort") ?? "cases/risk-stress-cohort-v1.json";
const promptVersion = (parseArg("--prompt") ?? "14") as "14" | "15";
const offset = Number(parseArg("--offset") ?? "0");
const limit = Number(parseArg("--limit") ?? "0");
const dryRun = process.argv.includes("--dry");

const data = JSON.parse(readFileSync(cohortPath, "utf8")) as { records: CohortRecord[] };
const records = limit > 0 ? data.records.slice(offset, offset + limit) : data.records.slice(offset);
console.log(`${cohortPath}: ${records.length} headwords`);

const manifest: EvidenceManifest = {
  case_set: "risk-stress-cohort/1",
  extraction_version: promptVersion === "15" ? "risk-evidence-stress/2" : "usefulness-headword-evidence-stress/2",
  sources: {
    oewn: { release: "oewn:2025", retrieved_via: "wn 1.1.1" },
    wordfreq: { version: "3.1.1", wordlist: "large" },
    candidate_pool: { path: "pool.sqlite", sha256: "a54bb48e144d07108e6f72a0a3f2336b1d8e846e40c958522d969164cd456aa1" },
  },
  deterministic_rules: { source: "stress_gates.ts", sha256: null },
  claims: Object.fromEntries(records.map((record) => [record.lemma, record.lemma])),
};

const apiKey = requireEnv("OPENROUTER_API_KEY");
const model = modelConfigFromEnv();
const store = new RunStore("runs");

if (promptVersion === "14") {
  const subjects: HeadwordSubject[] = records.map((record) =>
    buildHeadwordSubject({
      headword: record.lemma,
      display: record.display,
      meanings: [
        {
          candidate: { pos: record.pos ?? [] },
          policy_context: { endorsements: 0 },
        },
      ],
    } as unknown as Parameters<typeof buildHeadwordSubject>[0]),
  );
  await runStress<HeadwordSubject, WordLevelFinding>(
    subjects,
    manifest,
    {
      prompt: "usefulness-prompt/14",
      rubric: "usefulness-rubric/12",
      contract: "usefulness-finding/5",
      policy: "usefulness-policy/4",
    },
    (subject) => [
      { role: "system", content: V14_RUBRIC },
      { role: "user", content: renderWordLevelSubject(subject) },
    ],
    (content, subject) => parseFinding(content, subject.normalized),
    wordLevelFindingSchema,
    wordLevelVerdict,
    (verdict, finding) => {
      if (verdict === "useful") {
        return { disposition: "advance", reason: "the headword rewards deliberate study" };
      }
      if (verdict === "not_useful") {
        return { disposition: "exclude", reason: "the headword does not reward deliberate study" };
      }
      return { disposition: "quarantine", reason: "the model does not know the headword well enough" };
    },
    apiKey,
    model,
    store,
    dryRun,
  );
} else {
  const perSense = loadPerSenseEvidence("evidence/risk-per-sense.jsonl");
  const subjects: AudienceRiskSubject[] = records.map((record) =>
    buildSubjectFromCohort(
      {
        lemma: record.lemma,
        display: record.display,
        cohort: "control",
        wik_first: record.wik_first ?? null,
        wik_labels: record.wik_labels ?? null,
        f_informal: false,
        endorsements: 0,
        zipf_summed: 0,
        parts_of_speech: record.pos ?? [],
      },
      perSense,
    ),
  );
  await runStress<AudienceRiskSubject, AudienceRiskFinding>(
    subjects,
    manifest,
    {
      prompt: "usefulness-prompt/15",
      rubric: "usefulness-rubric/13",
      contract: "usefulness-finding/6",
      policy: "usefulness-policy/6",
    },
    (subject) => [
      { role: "system", content: V15_RUBRIC },
      { role: "user", content: renderAudienceRiskSubject(subject) },
    ],
    (content, subject) => parseFinding(content, subject.normalized),
    audienceRiskFindingSchema,
    audienceRiskVerdict,
    (_verdict, finding) => audienceRiskDisposition(finding),
    apiKey,
    model,
    store,
    dryRun,
  );
}

function parseFinding(content: string, lemma: string) {
  try {
    const parsed = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { headword?: unknown }).headword !== "string" ||
      (parsed as { headword: string }).headword.toLowerCase() !== lemma.toLowerCase()
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

interface Versions {
  prompt: string;
  rubric: string;
  contract: string;
  policy: string;
}

type SubjectIdFn<T> = (subject: T) => string;
type InputDigestFn<T> = (subject: T) => string;
type BuildMessagesFn<T> = (subject: T) => { role: "system" | "user"; content: string }[];
type DecideFn<F, V> = (verdict: V, finding: F) => { disposition: "advance" | "exclude" | "quarantine"; reason: string };

async function runStress<TSubject, TFinding>(
  subjects: TSubject[],
  manifest: EvidenceManifest,
  versions: Versions,
  buildMessages: BuildMessagesFn<TSubject>,
  parseContent: (content: string, subject: TSubject) => unknown,
  findingSchema: z.ZodType<TFinding>,
  verdictFn: (finding: TFinding) => string,
  decideFn: DecideFn<TFinding, string>,
  apiKey: string,
  model: ReturnType<typeof modelConfigFromEnv>,
  store: RunStore,
  dryRun: boolean,
) {
  const gate = {
    name: "audience-usefulness",
    versions,
    jsonSchema: z.toJSONSchema(findingSchema, {
      target: "draft-2020-12",
    }) as Record<string, unknown>,
    subjectId: (subject: TSubject) => (subject as { subject_id: string }).subject_id,
    inputDigest: (subject: TSubject) => (subject as { input_digest: string }).input_digest,
    buildMessages,
    parse: (content: string, subject: TSubject) => {
      const raw = parseContent(content, subject);
      const parsed = findingSchema.safeParse(raw);
      if (!parsed.success) {
        return { raw, finding: null, error: "schema mismatch" };
      }
      return { raw, finding: parsed.data ?? null, error: null };
    },
    decide: (finding: TFinding) => {
      const verdict = verdictFn(finding);
      return decideFn(verdict, finding);
    },
    policyContext: () => ({}),
  };

  const unpaid = subjects.filter(
    (subject) =>
      !store.get(
        buildFingerprint(
          (subject as { input_digest: string }).input_digest,
          manifest,
          model,
          versions,
        ),
      ),
  );

  const { check } = await preflight(unpaid, gate, model, apiKey);
  console.log(
    `${versions.prompt}, ${versions.rubric}, ${subjects.length} stress headwords`,
  );
  console.log(`${unpaid.length} new calls, ${subjects.length - unpaid.length} reusable records`);
  console.log(describeBudget(check, model, PILOT_BUDGET_USD));
  if (!check.allowed) throw new Error("estimate exceeds remaining pilot budget");
  if (dryRun) {
    console.log("--dry: no calls made");
    return;
  }

  const client = createClient(apiKey);
  let advance = 0;
  let exclude = 0;
  let quarantine = 0;
  let reused = 0;

  for (const subject of subjects) {
    const outcome = await adjudicate(subject, gate, client, model, manifest, store);
    if (outcome.reused) reused += 1;
    const disposition = outcome.record.effective?.disposition ?? "quarantine";
    if (disposition === "advance") advance += 1;
    else if (disposition === "exclude") exclude += 1;
    else quarantine += 1;
  }

  console.log(
    `\n${versions.prompt} on stress cohort: advance=${advance}, exclude=${exclude}, quarantine=${quarantine}`,
  );
  console.log(`records reused: ${reused}`);
  console.log(`total recorded spend: $${spentSoFar("runs").toFixed(4)} of $${PILOT_BUDGET_USD.toFixed(2)}`);
}
