// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildSummary, parseSummary, summaryDigest } from "./summarize.js";

const counts = {
  cases: 2, requiredTrials: 6, validTrials: 5, invalidTrials: 1, failedTrials: 0, unresolvedTrials: 0, missingTrials: 0,
  trialWrongAccepts: 2, trialWrongRejects: 0, averagedWrongAccepts: 0, averagedWrongRejects: 0,
  casesAllThreeCorrect: 1, unstableCases: 1, passedCases: 1, goldenRequirementsPass: false
};
const base = {
  experimentId: "0d89389e-87c7-4ff5-8063-85c59d27c6d2", datasetId: "1516e404-73bf-4a5a-86f0-880dd3b9f993", datasetVersion: 1,
  configurationFingerprint: "a".repeat(64), pinnedModel: "typesafe/jev-1.13-20260917", purpose: "evaluation" as const, split: "all" as const,
  summary: counts, spend: { knownNanoUsd: 86_520, unresolvedRequests: 2, physicalRequests: 7 },
  startedAt: new Date("2026-10-04T12:00:00Z"), finishedAt: new Date("2026-10-04T12:00:09Z")
};

describe("aggregate summary artifact", () => {
  it("builds fixed fields and rates with explicit denominators", () => {
    const summary = buildSummary(base);
    expect(summary.rates.trialsCorrect).toEqual({ numerator: 3, denominator: 6, value: 0.5 });
    expect(summary.rates.casesPassed).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(summary.timing).toEqual({ startedAt: "2026-10-04T12:00:00.000Z", finishedAt: "2026-10-04T12:00:09.000Z", durationSeconds: 9 });
    expect(summary.cost).toEqual({ knownUsd: 0.00008652, unresolvedRequests: 2, physicalRequests: 7 });
    expect(summaryDigest(summary)).toMatch(/^[a-f0-9]{64}$/);
    expect(summaryDigest(parseSummary(JSON.parse(JSON.stringify(summary))))).toBe(summaryDigest(summary));
  });

  it("rejects extra fields, free text and private identifiers", () => {
    const summary = buildSummary(base);
    expect(() => parseSummary({ ...summary, note: "harmless-free-text" })).toThrow();
    expect(() => parseSummary({ ...summary, counts: { ...summary.counts, caseIds: ["x"] } })).toThrow();
    expect(() => parseSummary({ ...summary, pinnedModel: "a model with spaces" })).toThrow();
  });

  it("rejects counts that do not add up to three trials per case", () => {
    expect(() => buildSummary({ ...base, summary: { ...counts, missingTrials: 1 } })).toThrow();
    expect(() => buildSummary({ ...base, summary: { ...counts, requiredTrials: 5 } })).toThrow();
  });

  it("never reports a pass or an invented zero for an empty set", () => {
    const empty = { ...counts, cases: 0, requiredTrials: 0, validTrials: 0, invalidTrials: 0, trialWrongAccepts: 0,
      casesAllThreeCorrect: 0, unstableCases: 0, passedCases: 0, goldenRequirementsPass: true };
    expect(() => buildSummary({ ...base, summary: empty })).toThrow();
    const none = buildSummary({ ...base, summary: { ...empty, goldenRequirementsPass: false } });
    expect(none.rates.casesPassed).toEqual({ numerator: 0, denominator: 0, value: null });
  });
});
