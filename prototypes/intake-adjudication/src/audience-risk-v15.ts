import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { z } from "zod";

import type { DispositionResult } from "./disposition.ts";
import { canonicalJson } from "./fingerprint.ts";

const RISK_LABEL_TOKENS = new Set([
  "offensive",
  "slur",
  "ethnic slur",
  "ethnic-slur",
  "vulgar",
  "derogatory",
  "pejorative",
  "taboo",
  "profanity",
  "obscene",
  "coarse",
  "sexual",
  "racially offensive",
  "homophobic",
  "transphobic",
  "misogynistic",
]);

export const V15_RUBRIC = `You judge one English headword for audience-risk in WordWell.

WordWell teaches literate adults words that expand expressive range. WordWell
does not ship lessons whose headword's ordinary usage is offensive, derogatory,
sexually explicit, bodily/vulgar, or otherwise an audience risk for the
target learner.

You will see the headword, its recorded parts of speech, and any Wiktionary
usage labels that were fetched for it. Wiktionary labels are partial: many
risk-bearing words carry no label, and some labelled words are benign. Do not
treat the labels as the answer. Use your general knowledge of ordinary
English to assess the headword's ordinary profile and tell us whether it
poses audience risk.

OUTPUT. For each headword, return:

- familiarity: common | less_common | uncommon | unknown
- audience_risk: clear | sensitive | blocked
  - clear: the ordinary usage is safe for WordWell's audience
  - sensitive: the word has a plausible vulgar, derogatory, sexually explicit,
    bodily, or otherwise unsuitable connotation; WordWell excludes it
  - blocked: the ordinary usage is clearly offensive, derogatory, sexually
    explicit, bodily/vulgar, or otherwise unsuitable; WordWell excludes it
- rationale: one or two sentences grounded in the supplied evidence and
  general knowledge, citing supplied labels when they support the call.

Do not decide whether the word should be taught, kept, or dropped; the
deterministic policy maps any audience risk to exclusion.`;

export const audienceRiskFindingSchema = z.strictObject({
  headword: z.string(),
  familiarity: z.enum(["common", "less_common", "uncommon", "unknown"]),
  audience_risk: z.enum(["clear", "sensitive", "blocked"]),
  rationale: z.string(),
});

export type AudienceRiskFinding = z.infer<typeof audienceRiskFindingSchema>;
export type AudienceRiskVerdict = "clear" | "sensitive" | "blocked" | "insufficient_knowledge";

export interface AudienceRiskSubject {
  subject_id: string;
  input_digest: string;
  normalized: string;
  display: string;
  parts_of_speech: string[];
  wik_first: string[];
  wik_labels: string[];
  wik_missing: boolean;
  cohort: "at-risk" | "control" | "v14-keep";
}

interface PerSenseRow {
  lemma: string;
  wik_first: string[] | null;
  wik_labels: string[];
  fingerprint: string;
}

function parseLabelString(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(/[,|]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function buildSubjectFromCohort(record: {
  lemma: string;
  display: string;
  cohort: "at-risk" | "control" | "v14-keep";
  wik_first: string | null;
  wik_labels: string | null;
  f_informal?: boolean;
  endorsements?: number;
  zipf_summed?: number;
  parts_of_speech?: string[];
}, perSense: Map<string, PerSenseRow>): AudienceRiskSubject {
  const row = perSense.get(record.lemma);
  const wikFirst = row?.wik_first ?? parseLabelString(record.wik_first);
  const wikLabels = row?.wik_labels ?? parseLabelString(record.wik_labels);
  const input = {
    headword: record.display,
    parts_of_speech: (record.parts_of_speech ?? []).sort(),
    wik_first: [...wikFirst].sort(),
    wik_labels: [...wikLabels].sort(),
  };
  return {
    subject_id: record.lemma,
    input_digest: createHash("sha256").update(canonicalJson(input)).digest("hex"),
    normalized: record.lemma,
    display: record.display,
    parts_of_speech: record.parts_of_speech ?? [],
    wik_first: wikFirst,
    wik_labels: wikLabels,
    wik_missing: !row,
    cohort: record.cohort,
  };
}

export function renderAudienceRiskSubject(subject: AudienceRiskSubject): string {
  const lines = ["HEADWORD", `word: ${subject.display}`];
  if (subject.parts_of_speech.length > 0) {
    lines.push(`recorded parts of speech: ${subject.parts_of_speech.join(", ")}`);
  } else {
    lines.push("recorded parts of speech: none recorded");
  }
  if (subject.wik_first.length > 0) {
    lines.push("");
    lines.push("WIKTIONARY FIRST-SENSE LABELS");
    lines.push(subject.wik_first.join(", "));
  }
  if (subject.wik_labels.length > 0) {
    lines.push("");
    lines.push("WIKTIONARY ALL-SENSE LABELS (deduped)");
    lines.push(subject.wik_labels.join(", "));
  }
  if (subject.wik_missing) {
    lines.push("");
    lines.push("WIKTIONARY: no entry found for this headword during label acquisition");
  }
  return lines.join("\n");
}

export function audienceRiskVerdict(finding: AudienceRiskFinding): AudienceRiskVerdict {
  if (finding.audience_risk === "clear") return "clear";
  if (finding.audience_risk === "sensitive") return "sensitive";
  if (finding.audience_risk === "blocked") return "blocked";
  return "insufficient_knowledge";
}

export function audienceRiskDisposition(finding: AudienceRiskFinding): DispositionResult {
  const verdict = audienceRiskVerdict(finding);
  if (verdict === "clear") {
    return { disposition: "advance", reason: "the headword is safe for the WordWell audience" };
  }
  if (verdict === "sensitive") {
    return { disposition: "exclude", reason: "the headword has an audience-risk connotation" };
  }
  if (verdict === "blocked") {
    return { disposition: "exclude", reason: "the headword is blocked for the WordWell audience" };
  }
  return { disposition: "quarantine", reason: "the model does not know the headword well enough" };
}

export function programmaticRiskLabel(tokens: string[]): boolean {
  for (const token of tokens) {
    if (RISK_LABEL_TOKENS.has(token.toLowerCase())) return true;
  }
  return false;
}

export function loadPerSenseEvidence(path: string): Map<string, PerSenseRow> {
  const map = new Map<string, PerSenseRow>();
  const lines = readFileSync(path, "utf8").split(/\n+/).filter((line) => line.length > 0);
  for (const line of lines) {
    const row = JSON.parse(line) as PerSenseRow;
    map.set(row.lemma, row);
  }
  return map;
}
