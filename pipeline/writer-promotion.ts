import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fingerprint } from "./config.js";
import { PrivateError } from "./storage/crypto.js";
import type { WriterStore } from "./storage/writer.js";
import type { createWriterEvaluator } from "../evals/writer.js";

export async function writerPromotionRuleIdentity() {
  const paths = ["./writer-promotion.ts", "./stages/writer.ts", "./sources/writer.ts", "./execution/openrouter.ts", "./execution/luna-response.ts", "./storage/writer.ts", "./storage/postgres.ts", "../evals/writer.ts", "../evals/datasets/writer.ts"];
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  return fingerprint({ rule: "three-valid-trials-owner-factual-grounding-coverage-review-all-teaching-fields-no-numeric-threshold-v1",
    dependencies: ["zod", "ai", "@openrouter/ai-sdk-provider"].map(name => lock.packages[`node_modules/${name}`]),
    implementation: await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))) });
}
export const writerReviewSchema = z.object({ schema: z.literal("wordwell-writer-trial-review-v1"), reviewer: z.literal("local-owner"), experimentId: z.uuid(), attemptId: z.uuid(),
  resultFingerprint: z.string().regex(/^[a-f0-9]{64}$/), factualityPassed: z.boolean(), groundingPassed: z.boolean(), coveragePassed: z.boolean(),
  examplesAndCoachingReviewed: z.literal(true), contrastsReviewed: z.literal(true), notesReviewed: z.literal(true), patternsReviewed: z.literal(true),
  quality: z.number().int().min(1).max(5), findings: z.array(z.string()), reference: z.string().min(1) }).strict();
type Inspector = Pick<ReturnType<typeof createWriterEvaluator>, "inspect">;
export async function recordWriterReview(store: WriterStore, evaluator: Inspector, value: unknown) {
  const review = writerReviewSchema.parse(value), report = await evaluator.inspect(review.experimentId);
  const outcome = report.outcomes.find(o => o.attempt?.id === review.attemptId);
  if (!outcome?.contractPass || fingerprint(outcome.attempt!.result) !== review.resultFingerprint) throw new PrivateError("writer_review_evidence_invalid");
  const id = randomUUID();
  await store.saveWriterReview({ id, experimentId: review.experimentId, attemptId: review.attemptId, configurationFingerprint: report.configurationFingerprint, material: review });
  return { id, modelCalls: 0 };
}
export async function recordWriterDecision(store: WriterStore, evaluator: Inspector, value: { experimentId: string; decision: "promote" | "do_not_promote"; reference: string }) {
  const decision = z.object({ experimentId: z.uuid(), decision: z.enum(["promote", "do_not_promote"]), reference: z.string().min(1) }).strict().parse(value);
  const report = await evaluator.inspect(decision.experimentId), reviews = await store.writerReviews(decision.experimentId), reviewIds: string[] = [];
  if (decision.decision === "promote") {
    if (report.material.testedRuleIdentity !== await writerPromotionRuleIdentity()) throw new PrivateError("writer_tested_interpretation_changed");
    if (!report.summary.requiredTrials || report.summary.validTrials !== report.summary.requiredTrials) throw new PrivateError("writer_evaluation_not_passing");
    for (const outcome of report.outcomes) {
      const saved = reviews.find(r => r.attemptId === outcome.attempt!.id), review = saved ? writerReviewSchema.parse(saved.material) : null;
      if (!review || saved!.configurationFingerprint !== report.configurationFingerprint || review.resultFingerprint !== fingerprint(outcome.attempt!.result) ||
        !review.factualityPassed || !review.groundingPassed || !review.coveragePassed) throw new PrivateError("writer_review_not_passing");
      reviewIds.push(saved!.id);
    }
  }
  const id = randomUUID();
  await store.saveWriterPromotion({ id, experimentId: decision.experimentId, configurationFingerprint: report.configurationFingerprint, decision: decision.decision,
    material: { schema: "wordwell-writer-promotion-v1", reviewer: "local-owner", ...decision, configurationFingerprint: report.configurationFingerprint,
      implementation: report.material.implementation, ruleIdentity: report.material.testedRuleIdentity, datasetContentIdentity: report.material.datasetContentIdentity, reviews: reviewIds } });
  return { id, decision: decision.decision, modelCalls: 0 };
}
export async function requireWriterPromotion(store: WriterStore, fingerprint: string) {
  const promotion = await store.currentWriterPromotion(fingerprint);
  if (!promotion || promotion.decision !== "promote") throw new PrivateError("writer_configuration_not_promoted");
  const material = z.object({ schema: z.literal("wordwell-writer-promotion-v1"), reviewer: z.literal("local-owner"), decision: z.literal("promote"), experimentId: z.uuid(),
    configurationFingerprint: z.string(), implementation: z.string(), ruleIdentity: z.string(), datasetContentIdentity: z.string(), reviews: z.array(z.uuid()).min(3), reference: z.string().min(1) }).strict().parse(promotion.material);
  if (material.configurationFingerprint !== fingerprint || material.ruleIdentity !== await writerPromotionRuleIdentity() || material.experimentId !== promotion.experimentId || new Set(material.reviews).size !== material.reviews.length)
    throw new PrivateError("writer_promotion_evidence_invalid");
  return promotion;
}
