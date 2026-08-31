// Loading the usefulness golden set.
//
// The case file is the label. There is no separate labels/*.jsonl here because
// the label is one categorical bucket per headword — that was the point of the
// #49 retreat from per-sense verdicts, which is where the retracted labels came
// from. Keeping the bucket next to the reason it was assigned means a reviewer
// reads the criterion and the verdict in the same place.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { Disposition } from "../src/disposition.ts";
import type { EvidenceManifest } from "../src/fingerprint.ts";
import { readManifest } from "../src/fingerprint.ts";
import { readCandidateMeanings } from "../src/usefulness/meaning.ts";
import type { HeadwordGroup } from "../src/usefulness/run.ts";
import { groupByHeadword } from "../src/usefulness/run.ts";

export const buckets = ["serve", "reject", "borderline"] as const;
export type Bucket = (typeof buckets)[number];

/**
 * The human bucket maps onto the shared disposition vocabulary.
 *
 * `borderline` is quarantine rather than a third outcome: a word the owner
 * cannot call is exactly a word a human should see, which is what quarantine
 * means everywhere else in the pipeline.
 */
export const bucketDisposition: Record<Bucket, Disposition> = {
  serve: "advance",
  reject: "exclude",
  borderline: "quarantine",
};

const caseFileSchema = z.object({
  set_version: z.string(),
  gate: z.literal("audience-usefulness"),
  cases: z
    .array(
      z.object({
        lemma: z.string(),
        bucket: z.enum(buckets),
        /** The slice this case belongs to, named by what would lift it. */
        reason: z.string(),
        why: z.string(),
      }),
    )
    .min(1),
});

/**
 * What the eval passes as `input`.
 *
 * Deliberately small. Passing the whole `HeadwordGroup` put every meaning's
 * definition and examples into Braintrust's Input column, which then truncated
 * to `{"display":"p...` on all twelve rows — a table where no column told you
 * which word you were looking at. The scorers resolve the meanings through
 * `meaningsOf`.
 */
export interface EvalInput {
  lemma: string;
  display: string;
  meaning_count: number;
}

const groupsByLemma = new Map<string, HeadwordGroup>();

export function evalInputOf(group: HeadwordGroup): EvalInput {
  groupsByLemma.set(group.headword, group);
  return { lemma: group.headword, display: group.display, meaning_count: group.meanings.length };
}

/** The meanings behind an eval input, in the order they were judged. */
export function meaningsOf(input: EvalInput) {
  const group = groupsByLemma.get(input.lemma);
  if (!group) throw new Error(`no loaded group for ${input.lemma}; load the dataset first`);
  return group.meanings;
}

export interface UsefulnessCase {
  group: HeadwordGroup;
  expected: {
    lemma: string;
    bucket: Bucket;
    disposition: Disposition;
    reason: string;
    why: string;
  };
}

export interface LoadedUsefulnessDataset {
  name: string;
  setVersion: string;
  manifest: EvidenceManifest;
  cases: UsefulnessCase[];
}

export function loadUsefulnessDataset(
  name = "usefulness-golden-v2",
  root = process.cwd(),
): LoadedUsefulnessDataset {
  const spec = caseFileSchema.parse(
    JSON.parse(readFileSync(join(root, `cases/${name}.json`), "utf8")),
  );
  const groups = new Map(
    groupByHeadword(readCandidateMeanings(join(root, `evidence/${name}.meanings.jsonl`))).map(
      (group) => [group.headword, group],
    ),
  );
  const manifest = readManifest(join(root, `evidence/${name}.manifest.json`));

  const seen = new Set<string>();
  const cases = spec.cases.map((entry) => {
    const key = entry.lemma.toLowerCase();
    if (seen.has(key)) throw new Error(`${entry.lemma} appears twice in the case set`);
    seen.add(key);

    const group = groups.get(key);
    if (!group) throw new Error(`no evidence for ${entry.lemma}; re-run the exporter`);

    // Evidence that has drifted from the manifest would be scored as if it were
    // the evidence the labels were written against.
    for (const meaning of group.meanings) {
      const expectedDigest = manifest.claims[meaning.subject_id];
      if (expectedDigest === undefined) {
        throw new Error(`${meaning.subject_id} is not in the manifest`);
      }
      if (expectedDigest !== meaning.input_digest) {
        throw new Error(`input digest mismatch for ${meaning.subject_id}`);
      }
    }

    return {
      group,
      expected: {
        lemma: key,
        bucket: entry.bucket,
        disposition: bucketDisposition[entry.bucket],
        reason: entry.reason,
        why: entry.why,
      },
    };
  });

  for (const headword of groups.keys()) {
    if (!seen.has(headword)) throw new Error(`evidence for ${headword} has no case entry`);
  }

  return { name, setVersion: spec.set_version, manifest, cases };
}

/** Every lemma the golden set touches. The retention audit must avoid all of them. */
export function goldenLemmas(root = process.cwd(), name = "usefulness-golden-v2"): Set<string> {
  const spec = caseFileSchema.parse(
    JSON.parse(readFileSync(join(root, `cases/${name}.json`), "utf8")),
  );
  return new Set(spec.cases.map((entry) => entry.lemma.toLowerCase()));
}

// ── Unlabelled sets ────────────────────────────────────────────────────────
//
// The retention audit and any exploration draw carry no verdicts, and the
// loader is separate so they cannot accidentally acquire one. `loadUsefulness-
// Dataset` requires a bucket per case; anything routed through it would have to
// be labelled first, which is precisely what must not happen to the audit.

const unlabelledFileSchema = z.object({
  set_version: z.string(),
  gate: z.literal("audience-usefulness"),
  /**
   * Which rule about overlap applies.
   *
   * `audit` must never share a word with the golden set: it is a frozen
   * instrument, and a retention rate measured over words the prompt was tuned on
   * reads exactly like an honest one. Enforced.
   *
   * `exploration` is expected to overlap eventually — promoting its interesting
   * cases into the golden set is what it is for. Warned, not enforced, because a
   * promoted word in a re-run is no longer independent evidence and the reader
   * should know how many there are.
   */
  role: z.enum(["audit", "exploration"]),
  sample: z.array(z.object({ lemma: z.string(), display: z.string() })).min(1),
});

export interface LoadedUnlabelledSet {
  name: string;
  setVersion: string;
  role: "audit" | "exploration";
  manifest: EvidenceManifest;
  groups: HeadwordGroup[];
  /** Requested headwords the exporter could not materialise. */
  missing: string[];
  /** Words since promoted into the golden set. Empty for an audit, by rule. */
  promoted: string[];
}

export function loadUnlabelledSet(name: string, root = process.cwd()): LoadedUnlabelledSet {
  const spec = unlabelledFileSchema.parse(
    JSON.parse(readFileSync(join(root, `cases/${name}.json`), "utf8")),
  );
  const manifest = readManifest(join(root, `evidence/${name}.manifest.json`));
  const groups = groupByHeadword(
    readCandidateMeanings(join(root, `evidence/${name}.meanings.jsonl`)),
  );

  for (const group of groups) {
    for (const meaning of group.meanings) {
      if (manifest.claims[meaning.subject_id] !== meaning.input_digest) {
        throw new Error(`input digest mismatch for ${meaning.subject_id}`);
      }
    }
  }

  const present = new Set(groups.map((g) => g.headword));
  const missing = spec.sample.map((w) => w.lemma).filter((lemma) => !present.has(lemma));

  const golden = goldenLemmas(root);
  const promoted = [...present].filter((lemma) => golden.has(lemma));
  if (spec.role === "audit" && promoted.length) {
    throw new Error(`${name} is an audit and overlaps the golden set: ${promoted.join(", ")}`);
  }

  return { name, setVersion: spec.set_version, role: spec.role, manifest, groups, missing, promoted };
}
