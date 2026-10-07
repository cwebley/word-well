import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fingerprint } from "./config.js";
import { PrivateError } from "./storage/crypto.js";
import type { PrivateStore } from "./storage/postgres.js";
import { createPlannerEvaluator } from "../evals/planner.js";

export async function plannerPromotionRuleIdentity() {
  const paths = ["./planner-promotion.ts", "./stages/planner.ts", "./sources/planner.ts", "./execution/openrouter.ts", "./execution/luna-response.ts", "./storage/postgres.ts", "../evals/planner.ts", "../evals/datasets/planner.ts"];
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  return fingerprint({ rule: "three-valid-trials-and-owner-factual-grounding-coverage-review-no-numeric-quality-threshold-v1",
    dependencies: ["zod", "ai", "@openrouter/ai-sdk-provider"].map(name => lock.packages[`node_modules/${name}`]),
    implementation: await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))) });
}

export const plannerReviewSchema = z.object({ schema: z.literal("wordwell-planner-trial-review-v1"), reviewer: z.literal("local-owner"),
  experimentId: z.uuid(), attemptId: z.uuid(), resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  factualityPassed: z.boolean(), groundingPassed: z.boolean(), coveragePassed: z.boolean(), quality: z.number().int().min(1).max(5), findings: z.array(z.string()), reference: z.string().min(1)
}).strict();
type Inspector = Pick<ReturnType<typeof createPlannerEvaluator>, "inspect">;
export async function recordPlannerReview(store: PrivateStore, evaluator: Inspector, value: unknown) {
  const review = plannerReviewSchema.parse(value), report = await evaluator.inspect(review.experimentId);
  const outcome = report.outcomes.find(o => o.attempt?.id === review.attemptId);
  if (!outcome?.contractPass || fingerprint(outcome.attempt!.result) !== review.resultFingerprint) throw new PrivateError("planner_review_evidence_invalid");
  const id = randomUUID();
  await store.savePlannerReview({ id, experimentId: review.experimentId, attemptId: review.attemptId, configurationFingerprint: report.configurationFingerprint, material: review });
  return { id, modelCalls: 0 };
}
export async function recordPlannerDecision(store: PrivateStore, evaluator: Inspector, options: { experimentId: string; decision: "promote" | "do_not_promote"; reference: string }) {
  const decision = z.object({ experimentId: z.uuid(), decision: z.enum(["promote", "do_not_promote"]), reference: z.string().min(1) }).strict().parse(options);
  const report = await evaluator.inspect(decision.experimentId), reviews = await store.plannerReviews(decision.experimentId);
  const reviewIds = [];
  if (decision.decision === "promote") {
    if (report.material.testedRuleIdentity !== await plannerPromotionRuleIdentity()) throw new PrivateError("planner_tested_interpretation_changed");
    if (!report.summary.requiredTrials || report.summary.validTrials !== report.summary.requiredTrials || report.summary.expectationPasses !== report.summary.requiredTrials) throw new PrivateError("planner_evaluation_not_passing");
    for (const outcome of report.outcomes) {
      const saved = reviews.find(r => r.attemptId === outcome.attempt!.id);
      const review = saved ? plannerReviewSchema.parse(saved.material) : null;
      if (!review || saved!.configurationFingerprint !== report.configurationFingerprint || review.resultFingerprint !== fingerprint(outcome.attempt!.result) ||
        !review.factualityPassed || !review.groundingPassed || !review.coveragePassed) throw new PrivateError("planner_review_not_passing");
      reviewIds.push(saved!.id);
    }
  }
  const id = randomUUID();
  await store.savePlannerPromotion({ id, experimentId: decision.experimentId, configurationFingerprint: report.configurationFingerprint, decision: decision.decision,
    material: { schema: "wordwell-planner-promotion-v1", reviewer: "local-owner", ...decision, configurationFingerprint: report.configurationFingerprint,
      implementation: report.material.implementation, ruleIdentity: report.material.testedRuleIdentity, datasetContentIdentity: report.material.datasetContentIdentity, reviews: reviewIds } });
  return { id, decision: decision.decision, modelCalls: 0 };
}
export async function requirePlannerPromotion(store: PrivateStore, fingerprint: string) {
  const promotion = await store.currentPlannerPromotion(fingerprint);
  if (!promotion || promotion.decision !== "promote") throw new PrivateError("planner_configuration_not_promoted");
  // Decisions are immutable and can be written only after all three reviewed
  // trials pass. No model or owner dataset key is needed to read authorization.
  const material = z.object({ schema: z.literal("wordwell-planner-promotion-v1"), reviewer: z.literal("local-owner"), decision: z.literal("promote"),
    experimentId: z.uuid(), configurationFingerprint: z.string(), implementation: z.string(), ruleIdentity: z.string(), datasetContentIdentity: z.string(), reviews: z.array(z.uuid()).min(3), reference: z.string().min(1) }).strict().parse(promotion.material);
  if (material.configurationFingerprint !== fingerprint || material.ruleIdentity !== await plannerPromotionRuleIdentity() || material.experimentId !== promotion.experimentId || new Set(material.reviews).size !== material.reviews.length) throw new PrivateError("planner_promotion_evidence_invalid");
  return promotion;
}
