// Frozen usefulness eval sets. The file's SHA-256 is the dataset version:
// any added case or corrected label is a new version, and results compare
// only within one version.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

const EXCLUDE_CATEGORIES = ["too_familiar", "too_specific", "intake_should_catch"] as const;

const usefulnessCase = z.strictObject({
  id: z.string().min(1),
  headword: z.string().min(1),
  partsOfSpeech: z.array(z.string()),
  // The owner's decision. For a soft case it is only a lean and is not scored.
  expected: z.enum(["keep", "exclude"]),
  category: z.enum(["keep", ...EXCLUDE_CATEGORIES, "soft"]),
  // Development labels carry a difficulty; held-out labels are collected without one.
  difficulty: z.enum(["clear", "hard"]).optional()
}).refine((c) => c.category === "soft" || (c.category === "keep") === (c.expected === "keep"),
  "category and expected decision disagree");

const datasetFile = z.strictObject({
  schema: z.literal("wordwell-usefulness-dataset/v1"),
  name: z.string().min(1),
  split: z.enum(["development", "held_out"]),
  sources: z.record(z.string(), z.string()).optional(),
  cases: z.array(usefulnessCase).min(1)
});

export type UsefulnessCase = z.infer<typeof usefulnessCase>;
export type Category = UsefulnessCase["category"];
export type UsefulnessDataset = { name: string; split: "development" | "held_out"; version: string; cases: UsefulnessCase[] };

export function loadUsefulnessDataset(path: string): UsefulnessDataset {
  const bytes = readFileSync(path);
  const file = datasetFile.parse(JSON.parse(bytes.toString("utf8")));
  const ids = new Set<string>();
  const headwords = new Set<string>();
  for (const c of file.cases) {
    const headword = c.headword.toLowerCase();
    if (ids.has(c.id) || headwords.has(headword)) throw new Error(`Duplicate case: ${c.id} ${c.headword}`);
    ids.add(c.id);
    headwords.add(headword);
  }
  return {
    name: file.name,
    split: file.split,
    version: createHash("sha256").update(bytes).digest("hex"),
    cases: file.cases
  };
}
