// Builds a committed usefulness dataset from the owner's private labels.
// Keeps only headword, OEWN parts of speech, decision, category and
// difficulty. Notes, timestamps and review-export names stay private.
//
// Usage:
//   npx tsx scripts/build-usefulness-dataset.ts LABELS_JSON POOL_SQLITE NAME OUT_JSON
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadUsefulnessDataset } from "../evals/datasets/usefulness.js";

type Label = {
  case_id: string;
  headword: string;
  decision: "keep" | "exclude";
  tags: { category: string; difficulty: string };
};

const [labelsPath, poolPath, name, outPath] = process.argv.slice(2);
if (!outPath) throw new Error("Usage: build-usefulness-dataset.ts LABELS_JSON POOL_SQLITE NAME OUT_JSON");

const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const labels = Object.values(JSON.parse(readFileSync(labelsPath, "utf8")) as Record<string, Label>);
const pool = new DatabaseSync(poolPath, { readOnly: true });
const lookup = pool.prepare("SELECT pos FROM lemma WHERE lemma = ?");

const cases = labels
  .map((label) => {
    const row = lookup.get(label.headword.toLowerCase()) as { pos: string } | undefined;
    if (!row?.pos) throw new Error(`No recorded POS in the pool for ${label.headword}`);
    return {
      id: label.case_id,
      headword: label.headword,
      partsOfSpeech: row.pos.split(","),
      expected: label.decision,
      category: label.tags.category,
      difficulty: label.tags.difficulty
    };
  })
  .sort((a, b) => a.headword.localeCompare(b.headword, "en"));

const dataset = {
  schema: "wordwell-usefulness-dataset/v1",
  name,
  split: "development",
  sources: { labels_sha256: sha256(labelsPath), pool_sha256: sha256(poolPath), parts_of_speech: "oewn:2025 via pool.sqlite" },
  cases
};
writeFileSync(outPath, JSON.stringify(dataset, null, 2) + "\n");
const loaded = loadUsefulnessDataset(outPath);
console.log(`${loaded.cases.length} cases -> ${outPath}\nversion ${loaded.version}`);
