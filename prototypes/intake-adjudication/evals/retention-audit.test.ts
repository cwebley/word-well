// The retention audit's three properties, checked rather than trusted.
//
// This set is the only holdout that costs no labelling time, and it stops being
// evidence the moment any of these slips. Cheap to assert, expensive to discover
// afterwards — a retention number computed over words the prompt was tuned on
// looks exactly like a real one.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { goldenLemmas, loadUsefulnessDataset } from "./usefulness-datasets.ts";

const audit = JSON.parse(readFileSync("cases/retention-audit-v1.json", "utf8")) as {
  set_version: string;
  sampling: { seed: number; target: number; population_size: number };
  sample: { lemma: string; endorsements: number }[];
};

describe("the retention audit sample", () => {
  it("is disjoint from every golden case", () => {
    const golden = goldenLemmas();
    const overlap = audit.sample.map((w) => w.lemma).filter((lemma) => golden.has(lemma));
    expect(overlap).toEqual([]);
  });

  it("carries no labels, so nobody can quietly score against it", () => {
    for (const word of audit.sample) {
      expect(word).not.toHaveProperty("bucket");
      expect(word).not.toHaveProperty("useful");
      expect(word).not.toHaveProperty("verdict");
      expect(word).not.toHaveProperty("expected");
    }
  });

  it("contains only endorsed words, which is what makes it free", () => {
    // Endorsement is the editorial work already done. A word with none is a word
    // somebody would have to label.
    expect(audit.sample.every((word) => word.endorsements > 0)).toBe(true);
  });

  it("holds the number it says it holds, with no duplicates", () => {
    expect(audit.sample).toHaveLength(audit.sampling.target);
    expect(new Set(audit.sample.map((w) => w.lemma)).size).toBe(audit.sample.length);
  });

  it("records the seed and population it was drawn from, so it can be redrawn", () => {
    expect(audit.sampling.seed).toBeGreaterThan(0);
    expect(audit.sampling.population_size).toBeGreaterThan(audit.sample.length);
  });
});

describe("the golden set", () => {
  it("splits into the trip-wire slices the plan asks for", () => {
    const dataset = loadUsefulnessDataset();
    const serve = dataset.cases.filter((c) => c.expected.bucket === "serve");
    const reject = dataset.cases.filter((c) => c.expected.bucket === "reject");

    expect(serve.length).toBeGreaterThanOrEqual(6);
    expect(reject.length).toBeGreaterThanOrEqual(6);
    // Six distinct reject reasons: one shared reason across all rejects would
    // make the set look balanced while testing one thing six times.
    expect(new Set(reject.map((c) => c.expected.reason)).size).toBe(reject.length);
  });

  it("covers more than one part of speech, so the gate is not tuned to adjectives", () => {
    const dataset = loadUsefulnessDataset();
    const partsOfSpeech = new Set(
      dataset.cases.flatMap((c) => c.group.meanings.map((m) => m.meaning.pos)),
    );
    expect(partsOfSpeech.size).toBeGreaterThanOrEqual(3);
  });
});

describe("the owner reject probe", () => {
  it("scores the named exploration words without changing the frozen draw", () => {
    const probe = loadUsefulnessDataset("usefulness-owner-reject-probe-v1");

    expect(probe.cases).toHaveLength(13);
    expect(probe.cases.every((entry) => entry.expected.bucket === "reject")).toBe(true);
    expect(probe.manifest.case_set).toBe("exploration-draw-1");
    expect(probe.cases.map((entry) => entry.expected.lemma)).toEqual([
      "chaperone",
      "cadaver",
      "clog",
      "eloquently",
      "feeder",
      "menstruation",
      "mileage",
      "mimic",
      "orbiter",
      "perfectionist",
      "rigorousness",
      "unarguably",
      "unmeasured",
    ]);
  });
});
