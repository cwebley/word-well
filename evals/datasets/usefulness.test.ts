// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadUsefulnessDataset } from "./usefulness.js";

const keep = { id: "word-1", headword: "parlance", partsOfSpeech: ["n"], expected: "keep", category: "keep", difficulty: "clear" };
const familiar = { id: "word-2", headword: "nuance", partsOfSpeech: ["n"], expected: "exclude", category: "too_familiar", difficulty: "clear" };
const soft = { id: "word-3", headword: "kibosh", partsOfSpeech: ["v"], expected: "exclude", category: "soft", difficulty: "hard" };

function datasetFile(cases: unknown[], extra: Record<string, unknown> = {}): { path: string; bytes: string } {
  const bytes = JSON.stringify({ schema: "wordwell-usefulness-dataset/v1", name: "usefulness-dev-test", split: "development", cases, ...extra });
  const path = join(mkdtempSync(join(tmpdir(), "usefulness-dataset-")), "dataset.json");
  writeFileSync(path, bytes);
  return { path, bytes };
}

describe("loadUsefulnessDataset", () => {
  it("returns the cases and uses the file's SHA-256 as the dataset version", () => {
    const { path, bytes } = datasetFile([keep, familiar, soft]);

    const dataset = loadUsefulnessDataset(path);

    expect(dataset.cases).toEqual([keep, familiar, soft]);
    expect(dataset.name).toBe("usefulness-dev-test");
    expect(dataset.version).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it.each([
    ["a keep category with an exclude decision", [{ ...keep, expected: "exclude" }]],
    ["an exclusion category with a keep decision", [{ ...familiar, expected: "keep" }]],
    ["an unknown category", [{ ...keep, category: "maybe" }]],
    ["an unknown field", [{ ...keep, note: "too basic" }]],
    ["the same headword twice, ignoring case", [keep, { ...familiar, id: "word-9", headword: "Parlance" }]],
    ["the same id twice", [keep, { ...familiar, id: "word-1" }]]
  ])("rejects %s", (_case, cases) => {
    expect(() => loadUsefulnessDataset(datasetFile(cases).path)).toThrow();
  });

  it("accepts held-out cases labelled without a difficulty", () => {
    const { difficulty: _omitted, ...undifficult } = keep;
    const { path } = datasetFile([undifficult], { split: "held_out" });

    expect(loadUsefulnessDataset(path).cases[0]).toEqual(undifficult);
  });

  it("accepts either decision for a soft case", () => {
    const { path } = datasetFile([soft, { ...soft, id: "word-4", headword: "persnickety", expected: "keep" }]);

    expect(loadUsefulnessDataset(path).cases).toHaveLength(2);
  });
});
