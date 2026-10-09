import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fingerprint } from "./config.js";
import { PrivateError } from "./storage/crypto.js";
import type { PrivateStore } from "./storage/postgres.js";
import { createPlannerEvaluator } from "../evals/planner.js";
import { requirePlannerRevalidation } from "./planner-revalidation.js";
import type { PlannerRevalidationStore } from "./storage/planner-revalidations.js";

export async function plannerPromotionRuleIdentity() {
  const paths = ["./planner-promotion.ts", "./planner-revalidation.ts", "./storage/planner-revalidations.ts", "../db/private-migrations/015_planner_revalidations.sql", "./stages/planner.ts", "./sources/planner.ts", "./execution/openrouter.ts", "./execution/luna-response.ts", "./storage/postgres.ts", "../evals/planner.ts", "../evals/datasets/planner.ts"];
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  return fingerprint({ rule: "three-valid-trials-and-owner-factual-grounding-coverage-review-no-numeric-quality-threshold-v1",
    dependencies: ["zod", "ai", "@openrouter/ai-sdk-provider"].map(name => lock.packages[`node_modules/${name}`]),
    implementation: await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))) });
}

const originalReviewSchema = z.object({ schema: z.literal("wordwell-planner-trial-review-v1"), reviewer: z.literal("local-owner"),
  experimentId: z.uuid(), attemptId: z.uuid(), resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  factualityPassed: z.boolean(), groundingPassed: z.boolean(), coveragePassed: z.boolean(), quality: z.number().int().min(1).max(5), findings: z.array(z.string()), reference: z.string().min(1)
}).strict();
export const plannerReviewSchema = z.union([originalReviewSchema, originalReviewSchema.extend({ schema: z.literal("wordwell-planner-trial-review-v2"),
  revalidationId: z.string().regex(/^[a-f0-9]{64}$/) }).strict()]);
type Inspector = Pick<ReturnType<typeof createPlannerEvaluator>, "inspect">;
async function evaluationEvidence(store: PrivateStore, evaluator: Inspector, experimentId: string, revalidationId?: string, revalidations?: PlannerRevalidationStore) {
  if (revalidationId) {
    if (!revalidations) throw new PrivateError("planner_revalidation_missing");
    const proof = await requirePlannerRevalidation(store, revalidations, revalidationId);
    if (proof.sourceExperimentId !== experimentId) throw new PrivateError("planner_review_evidence_invalid");
    return { configurationFingerprint: proof.configurationFingerprint, implementation: proof.implementation, testedRuleIdentity: proof.testedRuleIdentity,
      datasetContentIdentity: proof.sourceDataset.contentIdentity, passing: true,
      trials: proof.trials.map(trial => ({ attemptId: trial.attemptId, resultFingerprint: trial.resultFingerprint, contractPass: true })) };
  }
  const report = await evaluator.inspect(experimentId);
  return { configurationFingerprint: report.configurationFingerprint, implementation: report.material.implementation,
    testedRuleIdentity: report.material.testedRuleIdentity, datasetContentIdentity: report.material.datasetContentIdentity,
    passing: report.summary.requiredTrials > 0 && report.summary.validTrials === report.summary.requiredTrials && report.summary.expectationPasses === report.summary.requiredTrials,
    trials: report.outcomes.map(outcome => ({ attemptId: outcome.attempt?.id, resultFingerprint: outcome.attempt?.result == null ? null : fingerprint(outcome.attempt.result), contractPass: outcome.contractPass })) };
}
export async function recordPlannerReview(store: PrivateStore, evaluator: Inspector, value: unknown, revalidations?: PlannerRevalidationStore) {
  const review = plannerReviewSchema.parse(value);
  const evidence = await evaluationEvidence(store, evaluator, review.experimentId, review.schema === "wordwell-planner-trial-review-v2" ? review.revalidationId : undefined, revalidations);
  const outcome = evidence.trials.find(trial => trial.attemptId === review.attemptId);
  if (!outcome?.contractPass || outcome.resultFingerprint !== review.resultFingerprint) throw new PrivateError("planner_review_evidence_invalid");
  const id = randomUUID();
  await store.savePlannerReview({ id, experimentId: review.experimentId, attemptId: review.attemptId, configurationFingerprint: evidence.configurationFingerprint, material: review });
  return { id, modelCalls: 0 };
}
export async function recordPlannerDecision(store: PrivateStore, evaluator: Inspector, options: { experimentId: string; decision: "promote" | "do_not_promote"; reference: string; revalidationId?: string }, revalidations?: PlannerRevalidationStore) {
  const decision = z.object({ experimentId: z.uuid(), decision: z.enum(["promote", "do_not_promote"]), reference: z.string().min(1), revalidationId: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(options);
  const evidence = await evaluationEvidence(store, evaluator, decision.experimentId, decision.revalidationId, revalidations), reviews = await store.plannerReviews(decision.experimentId);
  const reviewIds = [];
  if (decision.decision === "promote") {
    if (evidence.testedRuleIdentity !== await plannerPromotionRuleIdentity()) throw new PrivateError("planner_tested_interpretation_changed");
    if (!evidence.passing) throw new PrivateError("planner_evaluation_not_passing");
    for (const outcome of evidence.trials) {
      const saved = reviews.find(r => {
        const parsed = plannerReviewSchema.safeParse(r.material);
        return parsed.success && r.attemptId === outcome.attemptId && r.configurationFingerprint === evidence.configurationFingerprint &&
          (decision.revalidationId ? parsed.data.schema === "wordwell-planner-trial-review-v2" && parsed.data.revalidationId === decision.revalidationId :
            parsed.data.schema === "wordwell-planner-trial-review-v1");
      });
      const review = saved ? plannerReviewSchema.parse(saved.material) : null;
      if (!review || review.resultFingerprint !== outcome.resultFingerprint ||
        !review.factualityPassed || !review.groundingPassed || !review.coveragePassed) throw new PrivateError("planner_review_not_passing");
      reviewIds.push(saved!.id);
    }
  }
  const id = randomUUID();
  const { revalidationId, ...ownerDecision } = decision;
  await store.savePlannerPromotion({ id, experimentId: decision.experimentId, configurationFingerprint: evidence.configurationFingerprint, decision: decision.decision,
    material: { schema: revalidationId ? "wordwell-planner-promotion-v2" : "wordwell-planner-promotion-v1", reviewer: "local-owner", ...ownerDecision,
      ...(revalidationId ? { revalidationId } : {}), configurationFingerprint: evidence.configurationFingerprint,
      implementation: evidence.implementation, ruleIdentity: evidence.testedRuleIdentity, datasetContentIdentity: evidence.datasetContentIdentity, reviews: reviewIds } });
  return { id, decision: decision.decision, modelCalls: 0 };
}
export async function requirePlannerPromotion(store: PrivateStore, configurationFingerprint: string, revalidations?: PlannerRevalidationStore) {
  const promotion = await store.currentPlannerPromotion(configurationFingerprint);
  if (!promotion || promotion.decision !== "promote") throw new PrivateError("planner_configuration_not_promoted");
  // Decisions are immutable and can be written only after all three reviewed
  // trials pass. No model or owner dataset key is needed to read authorization.
  const original = z.object({ schema: z.literal("wordwell-planner-promotion-v1"), reviewer: z.literal("local-owner"), decision: z.literal("promote"),
    experimentId: z.uuid(), configurationFingerprint: z.string(), implementation: z.string(), ruleIdentity: z.string(), datasetContentIdentity: z.string(), reviews: z.array(z.uuid()).min(3), reference: z.string().min(1) }).strict();
  const material = z.union([original, original.extend({ schema: z.literal("wordwell-planner-promotion-v2"), revalidationId: z.string().regex(/^[a-f0-9]{64}$/) }).strict()]).parse(promotion.material);
  if (material.configurationFingerprint !== configurationFingerprint || material.ruleIdentity !== await plannerPromotionRuleIdentity() || material.experimentId !== promotion.experimentId || new Set(material.reviews).size !== material.reviews.length) throw new PrivateError("planner_promotion_evidence_invalid");
  if (material.schema === "wordwell-planner-promotion-v2") {
    if (!revalidations) throw new PrivateError("planner_revalidation_missing");
    const proof = await requirePlannerRevalidation(store, revalidations, material.revalidationId);
    if (proof.sourceExperimentId !== material.experimentId || proof.configurationFingerprint !== material.configurationFingerprint ||
      proof.implementation !== material.implementation || proof.testedRuleIdentity !== material.ruleIdentity || proof.sourceDataset.contentIdentity !== material.datasetContentIdentity)
      throw new PrivateError("planner_promotion_evidence_invalid");
  }
  return promotion;
}
