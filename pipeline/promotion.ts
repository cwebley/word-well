// A new assessment of saved evidence. Never changes historical scores,
// finalized summaries, exports or production selections. No model dependency.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fingerprint } from "./config.js";
import { configurationSchema, createAppropriatenessStage, thresholdsFor, resultSchema } from "./stages/appropriateness.js";
import { PrivateError, type PrivateCrypto } from "./storage/crypto.js";
import type { PrivateStore } from "./storage/postgres.js";
import { loadFrozenDataset, type DatasetManifest } from "../evals/authoring/store.js";
import { scoreCase, summarize, type TrialOutcome, type CaseScore } from "../evals/scorers/appropriateness.js";

export const PROMOTION_RULE = { schema: "wordwell-appropriateness-promotion-rule-v1", name: "heldout-averaged-accuracy-95",
  minimumCorrectPercent: 95, trialsPerCase: 3, nonemptyHeldOutRequired: true,
  countBothErrorDirections: true, individualErrorsVeto: false, developmentAccuracyVeto: false } as const;
export async function promotionRuleIdentity() {
  const files = ["./promotion.ts", "./stages/appropriateness.ts", "../evals/scorers/appropriateness.ts", "../evals/authoring/store.ts", "../evals/authoring/records.ts", "../evals/private-appropriateness.ts", "../evals/trials.ts"];
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  return fingerprint({ rule: PROMOTION_RULE, contractDependency: lock.packages["node_modules/zod"],
    implementation: await Promise.all(files.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))) });
}
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const counts = z.object({ cases: z.number().int().nonnegative(), correctAverages: z.number().int().nonnegative(),
  validTrials: z.number().int().nonnegative(), requiredTrials: z.number().int().nonnegative(),
  wrongAccepts: z.number().int().nonnegative(), wrongRejects: z.number().int().nonnegative(),
  individualWrongAccepts: z.number().int().nonnegative(), individualWrongRejects: z.number().int().nonnegative(),
  unstableCases: z.number().int().nonnegative(), allThreeCorrect: z.number().int().nonnegative() }).strict();
export const promotionAssessmentSchema = z.object({ schema: z.literal("wordwell-appropriateness-promotion-assessment-v1"),
  id: sha, ruleIdentity: sha, evidenceIdentity: sha, configurationFingerprint: sha,
  experimentId: z.uuid(), originalImplementationFingerprint: sha, originalSummarySha256: sha,
  dataset: z.object({ id: z.uuid(), version: z.number().int().positive(), ciphertextSha256: sha, contentIdentity: sha }).strict(),
  heldOut: counts, development: z.array(z.object({ experimentId: z.uuid(), datasetId: z.uuid(), datasetVersion: z.number().int().positive(), counts }).strict()),
  accuracy: z.number().min(0).max(1), qualifies: z.boolean(), modelCalls: z.literal(0)
}).strict();
export type PromotionAssessment = z.infer<typeof promotionAssessmentSchema>;
function assessmentCounts(scores: CaseScore[]): z.infer<typeof counts> {
  const summary = summarize(scores);
  return { cases: summary.cases, correctAverages: scores.filter(s => s.averaged.correct === true).length,
    validTrials: summary.validTrials, requiredTrials: summary.requiredTrials, wrongAccepts: summary.averagedWrongAccepts,
    wrongRejects: summary.averagedWrongRejects, individualWrongAccepts: summary.trialWrongAccepts,
    individualWrongRejects: summary.trialWrongRejects, unstableCases: summary.unstableCases, allThreeCorrect: summary.casesAllThreeCorrect };
}

export async function assessSavedPromotion(options: { store: PrivateStore; datasetDir: string; manifest: DatasetManifest; crypto: PrivateCrypto; experimentId: string }) {
  const { store, experimentId } = options;
  const release = await store.lockExperiment(experimentId);
  try {
    const experiment = await store.readExperiment(experimentId);
    if (!experiment?.finalizedAt || !experiment.summarySha256) throw new PrivateError("finalized_evidence_required");
    const material = z.object({ configuration: configurationSchema, purpose: z.literal("evaluation"), split: z.enum(["held-out", "all"]),
      dataset: z.object({ id: z.uuid(), version: z.number(), contentIdentity: sha }) }).passthrough().safeParse(experiment.material);
    if (!material.success || experiment.stage !== "appropriateness") throw new PrivateError("heldout_evaluation_required");
    const frozen = await loadFrozenDataset(options.datasetDir, options.manifest, options.crypto);
    if (frozen.id !== experiment.dataset.id || frozen.version !== experiment.dataset.version || frozen.contentIdentity !== material.data.dataset.contentIdentity ||
        options.manifest.ciphertextSha256 !== experiment.dataset.ciphertextSha256) throw new PrivateError("frozen_evidence_mismatch");
    const stage = createAppropriatenessStage(material.data.configuration);
    if (stage.fingerprint !== experiment.configurationFingerprint) throw new PrivateError("configuration_mismatch");
    const cases = await store.readCases(experimentId);
    const expectations = await store.readExpectations(experimentId);
    const expectedCases = frozen.cases.filter(c => material.data.split === "all" || c.split === "held-out");
    if (cases.length !== expectedCases.length || expectations.size !== expectedCases.length) throw new PrivateError("frozen_membership_mismatch");
    for (const c of expectedCases) {
      const saved = cases.find(row => row.caseId === c.id), expected = expectations.get(c.id);
      if (!saved || saved.input.headword !== c.content.headword || expected?.finding !== c.content.finding || expected.reason !== c.content.reason || expected.split !== c.split) throw new PrivateError("frozen_membership_mismatch");
    }
    const trials = await store.listTrials(experimentId);
    const evidence: unknown[] = [];
    const heldOutScores = [];
    for (const c of cases) {
      const expected = expectations.get(c.caseId)!;
      const outcomes: TrialOutcome[] = [];
      const caseTrials = trials.filter(t => t.caseId === c.caseId);
      if (caseTrials.some(t => t.trialIndex < 1 || t.trialIndex > 3) || new Set(caseTrials.map(t => t.trialIndex)).size !== caseTrials.length) throw new PrivateError("trial_identity_invalid");
      for (let index = 1; index <= 3; index++) {
        const trial = caseTrials.find(t => t.trialIndex === index);
        const attempt = trial ? await store.readAttempt(trial.attemptId) : null;
        evidence.push({ caseId: c.caseId, index, attempt });
        if (!attempt) continue;
        if (attempt.experimentId !== experimentId || attempt.stage !== "appropriateness" || fingerprint(attempt.input.request) !== fingerprint(stage.render(c.input))) throw new PrivateError("trial_evidence_mismatch");
        if (attempt.status === "valid") {
          const reply = attempt.requests.at(-1)?.response;
          const validation = reply?.kind === "response" ? stage.validate(reply.body) : null;
          const result = resultSchema.parse(attempt.result);
          if (!validation?.ok || fingerprint(validation.result) !== fingerprint(result)) throw new PrivateError("trial_evidence_mismatch");
          outcomes.push({ state: "valid", blockedProbability: result.blockedProbability, slurProbability: result.slurProbability, vulgarProbability: result.vulgarProbability });
        } else if (attempt.status !== "pending") outcomes.push({ state: attempt.status });
      }
      if (expected.split === "held-out") heldOutScores.push(scoreCase(expected.finding, outcomes, thresholdsFor(material.data.configuration)));
    }
    const heldOut = assessmentCounts(heldOutScores);
    // Development remains visible, including misses on earlier dataset versions.
    // Its denominator is reported independently and never becomes a second bar.
    const development = [];
    const { createPrivateAppropriatenessReader } = await import("../evals/private-appropriateness.js");
    const reader = createPrivateAppropriatenessReader(store);
    for (const other of await store.listExperiments()) {
      if (other.configurationFingerprint !== experiment.configurationFingerprint) continue;
      const description = await reader.describe(other.id);
      if (description.purpose !== "evaluation" || !["development", "all"].includes(description.split)) continue;
      const detailed = (await reader.caseResults(other.id)).filter(c => c.split === "development");
      if (!detailed.length) continue;
      development.push({ experimentId: other.id, datasetId: other.datasetId, datasetVersion: other.datasetVersion,
        counts: assessmentCounts(detailed.map(c => c.score)) });
    }
    development.sort((a, b) => a.experimentId.localeCompare(b.experimentId));
    const ruleIdentity = await promotionRuleIdentity();
    const dataset = { ...experiment.dataset, contentIdentity: frozen.contentIdentity };
    const evidenceIdentity = fingerprint({ experimentId, dataset, configurationFingerprint: experiment.configurationFingerprint,
      originalSummarySha256: experiment.summarySha256, cases, expectations: [...expectations].sort(([a], [b]) => a.localeCompare(b)), evidence, heldOut, development });
    const id = fingerprint({ ruleIdentity, evidenceIdentity });
    const assessment = promotionAssessmentSchema.parse({ schema: "wordwell-appropriateness-promotion-assessment-v1", id, ruleIdentity, evidenceIdentity,
      configurationFingerprint: experiment.configurationFingerprint, experimentId, originalImplementationFingerprint: experiment.implementationFingerprint,
      originalSummarySha256: experiment.summarySha256, dataset, heldOut, development, accuracy: heldOut.cases ? heldOut.correctAverages / heldOut.cases : 0,
      qualifies: heldOut.cases > 0 && heldOut.validTrials === heldOut.requiredTrials && heldOut.correctAverages * 100 >= heldOut.cases * 95, modelCalls: 0 });
    await release.assert();
    await store.savePromotionAssessment({ ...assessment, material: assessment });
    return assessment;
  } finally { await release(); }
}

const ownerDecisionSchema = z.object({ schema: z.literal("wordwell-owner-stage-promotion-v1"), reviewer: z.literal("local-owner"),
  issue: z.literal("https://github.com/cwebley/word-well/issues/17"),
  decisionReference: z.string().regex(/^https:\/\/github\.com\/cwebley\/word-well\/issues\/17#issuecomment-[0-9]+$/),
  assessmentId: sha, decision: z.enum(["promote", "do_not_promote"]) }).strict();

// Called only after the owner's explicit decision is recorded in #17.
export async function recordOwnerPromotion(store: PrivateStore, value: unknown) {
  const decision = ownerDecisionSchema.safeParse(value);
  if (!decision.success) throw new PrivateError("owner_decision_invalid");
  const record = decision.data;
  const assessment = await store.readPromotionAssessment(record.assessmentId);
  if (!assessment) throw new PrivateError("promotion_assessment_missing");
  const material = promotionAssessmentSchema.parse(assessment.material);
  if (material.ruleIdentity !== await promotionRuleIdentity()) throw new PrivateError("promotion_rule_changed");
  const id = randomUUID();
  await store.recordPromotion({ id, assessmentId: assessment.id, configurationFingerprint: assessment.configurationFingerprint, decision: record.decision, material: record });
  return { id, decision: record.decision, assessmentId: record.assessmentId };
}
export async function requirePromotion(store: PrivateStore, configurationFingerprint: string) {
  const promotion = await store.currentPromotion(configurationFingerprint);
  if (!promotion || promotion.decision !== "promote") throw new PrivateError("configuration_not_promoted");
  const decision = ownerDecisionSchema.parse(promotion.material);
  const assessment = await store.readPromotionAssessment(promotion.assessmentId);
  if (!assessment?.qualifies || decision.decision !== "promote" || decision.assessmentId !== assessment.id) throw new PrivateError("promotion_evidence_invalid");
  const material = promotionAssessmentSchema.parse(assessment.material);
  if (material.configurationFingerprint !== configurationFingerprint || material.ruleIdentity !== await promotionRuleIdentity() || !material.qualifies) throw new PrivateError("promotion_evidence_invalid");
  return promotion;
}
