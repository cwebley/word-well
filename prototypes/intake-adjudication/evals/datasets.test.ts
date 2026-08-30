import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadDataset } from "./datasets.ts";
import { readLabels } from "./types.ts";

describe("normal evaluation datasets", () => {
  it("rejects hidden holdout before reading any dataset path", () => {
    const absentRoot = join(tmpdir(), "wordwell-absent-dataset-root");

    expect(() => loadDataset("hidden_holdout", absentRoot)).toThrow(
      /normal development dataset/u,
    );
  });

  it("loads the validated contract set through the public boundary", () => {
    const loaded = loadDataset("contract-test", process.cwd());

    expect(loaded.cases).toHaveLength(6);
    expect(loaded.cases.every(({ expected }) => expected.label_status === "human-validated")).toBe(
      true,
    );
  });

  it("rejects duplicate canonical labels", () => {
    const directory = mkdtempSync(join(tmpdir(), "wordwell-labels-"));
    const source = readFileSync("labels/contract-test.labels.jsonl", "utf8").split("\n")[0];
    const path = join(directory, "duplicate.jsonl");
    writeFileSync(path, `${source}\n${source}\n`);

    expect(() => readLabels(path)).toThrow(/duplicate label/u);
  });
});
