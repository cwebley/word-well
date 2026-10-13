// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { plannerReviewSchema } from "./planner-promotion.js";
import { writerReviewSchema } from "./writer-promotion.js";

const common = { reviewer: "local-owner", experimentId: randomUUID(), attemptId: randomUUID(), resultFingerprint: "a".repeat(64),
  factualityPassed: true, groundingPassed: true, coveragePassed: true, findings: [], reference: "Controlled owner review." };
const teaching = { examplesAndCoachingReviewed: true, contrastsReviewed: true, notesReviewed: true, patternsReviewed: true };

describe("versioned optional content-review ratings", () => {
  it.each([
    { schema: plannerReviewSchema, value: { ...common, schema: "wordwell-planner-trial-review-v3" } },
    { schema: plannerReviewSchema, value: { ...common, schema: "wordwell-planner-trial-review-v3", revalidationId: "b".repeat(64) } },
    { schema: writerReviewSchema, value: { ...common, ...teaching, schema: "wordwell-writer-trial-review-v2" } }
  ])("retains an absent rating without inferring a score for $value.schema", ({ schema, value }) => {
    expect(schema.parse(value)).toEqual(value);
    expect(schema.parse({ ...value, quality: 1 })).toEqual({ ...value, quality: 1 });
    expect(schema.parse({ ...value, quality: 5 })).toEqual({ ...value, quality: 5 });
    for (const quality of [null, 0, 6, 2.5, "4"]) expect(schema.safeParse({ ...value, quality }).success).toBe(false);
    const { groundingPassed, ...incomplete } = value;
    expect(groundingPassed).toBe(true);
    expect(schema.safeParse(incomplete).success).toBe(false);
  });

  it("keeps historical review formats score-required", () => {
    const planner = { ...common, schema: "wordwell-planner-trial-review-v1" };
    const revalidated = { ...common, schema: "wordwell-planner-trial-review-v2", revalidationId: "b".repeat(64) };
    const writer = { ...common, ...teaching, schema: "wordwell-writer-trial-review-v1" };
    expect(plannerReviewSchema.safeParse(planner).success).toBe(false);
    expect(plannerReviewSchema.safeParse(revalidated).success).toBe(false);
    expect(writerReviewSchema.safeParse(writer).success).toBe(false);
    expect(plannerReviewSchema.parse({ ...planner, quality: 1 })).toEqual({ ...planner, quality: 1 });
    expect(plannerReviewSchema.parse({ ...revalidated, quality: 1 })).toEqual({ ...revalidated, quality: 1 });
    expect(writerReviewSchema.parse({ ...writer, quality: 1 })).toEqual({ ...writer, quality: 1 });
  });

  it.each(Object.keys(teaching))("still requires writer teaching-field review: %s", field => {
    const value: Record<string, unknown> = { ...common, ...teaching, schema: "wordwell-writer-trial-review-v2" };
    expect(writerReviewSchema.safeParse({ ...value, [field]: false }).success).toBe(false);
    delete value[field];
    expect(writerReviewSchema.safeParse(value).success).toBe(false);
  });
});
