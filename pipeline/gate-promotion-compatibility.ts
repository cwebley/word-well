// The original promotion checker and assessor keep their byte identities.
// Only the owner-approved #34 transition can use this additive proof path.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { fingerprint } from "./config.js";
import { GATE_COMPATIBILITY_POLICY, gateCompatibilityPolicyIdentity, parseGateCompatibility } from "./gate-compatibility.js";
import { assessSavedPromotion, promotionAssessmentSchema, promotionRuleIdentity, requirePromotion, type PromotionAssessment } from "./promotion.js";
import { PrivateError, type PrivateCrypto } from "./storage/crypto.js";
import type { PrivateStore } from "./storage/postgres.js";
import type { DatasetManifest } from "../evals/authoring/store.js";
import { createValidationOnlySystemOneAdapter } from "./execution/validation-only.js";
import { assertHistoricalGateExecution } from "./reuse.js";

const historicalOwnerDecision = z.object({ schema: z.literal("wordwell-owner-stage-promotion-v1"), reviewer: z.literal("local-owner"),
  issue: z.literal("https://github.com/cwebley/word-well/issues/17"),
  decisionReference: z.string().regex(/^https:\/\/github\.com\/cwebley\/word-well\/issues\/17#issuecomment-[0-9]+$/),
  assessmentId: z.string().regex(/^[a-f0-9]{64}$/), decision: z.literal("promote") }).strict();

function assessment(value: unknown) {
  const parsed = promotionAssessmentSchema.parse(value);
  if (parsed.id !== fingerprint({ ruleIdentity: parsed.ruleIdentity, evidenceIdentity: parsed.evidenceIdentity })) throw new PrivateError("promotion_evidence_invalid");
  return parsed;
}
function sameAssessment(original: PromotionAssessment, current: PromotionAssessment) {
  const { id: _oldId, ruleIdentity: _oldRule, evidenceIdentity: _oldEvidence, ...oldResult } = original;
  const { id: _newId, ruleIdentity: _newRule, evidenceIdentity: _newEvidence, ...newResult } = current;
  if (!isDeepStrictEqual(oldResult, newResult)) throw new PrivateError("promotion_evidence_invalid");
}
async function historicalPromotion(store: PrivateStore, configurationFingerprint: string) {
  // Keep the old decision binding, and accept only the inspected transition.
  await assertHistoricalGateExecution();
  const promotion = await store.currentPromotion(configurationFingerprint);
  if (!promotion || promotion.decision !== "promote") throw new PrivateError("configuration_not_promoted");
  const saved = await store.readPromotionAssessment(promotion.assessmentId);
  const original = saved && assessment(saved.material);
  if (!original?.qualifies || original.id !== saved?.id || original.configurationFingerprint !== configurationFingerprint || saved?.configurationFingerprint !== configurationFingerprint || !saved.qualifies ||
      original.ruleIdentity !== GATE_COMPATIBILITY_POLICY.originalRule || original.originalImplementationFingerprint !== GATE_COMPATIBILITY_POLICY.originalEvaluationImplementation ||
      await promotionRuleIdentity() !== GATE_COMPATIBILITY_POLICY.currentRule) throw new PrivateError("promotion_evidence_invalid");
  // A missing, malformed or differently bound decision cannot inherit a proof.
  const decision = historicalOwnerDecision.safeParse(promotion.material);
  if (!decision.success || decision.data.assessmentId !== original.id) throw new PrivateError("promotion_evidence_invalid");
  return { promotion, original };
}
export async function requireGatePromotion(store: PrivateStore, configurationFingerprint: string) {
  try { return await requirePromotion(store, configurationFingerprint); }
  catch (error) {
    if (!(error instanceof PrivateError) || error.code !== "promotion_evidence_invalid") throw error;
  }
  const { promotion, original } = await historicalPromotion(store, configurationFingerprint);
  const value = await store.readGateCompatibility({ kind: "promotion", subjectId: promotion.id,
    currentIdentity: GATE_COMPATIBILITY_POLICY.currentRule, policyIdentity: gateCompatibilityPolicyIdentity() });
  if (!value) throw new PrivateError("promotion_evidence_invalid");
  const proof = parseGateCompatibility(value);
  if (proof.kind !== "promotion" || proof.subjectId !== promotion.id || proof.originalIdentity !== original.ruleIdentity ||
      proof.currentIdentity !== GATE_COMPATIBILITY_POLICY.currentRule || proof.originalAssessmentId !== original.id) throw new PrivateError("promotion_evidence_invalid");
  const saved = await store.readPromotionAssessment(proof.currentAssessmentId);
  const current = saved && assessment(saved.material);
  if (!current?.qualifies || current.id !== saved?.id || !saved?.qualifies || saved.configurationFingerprint !== configurationFingerprint || current.ruleIdentity !== proof.currentIdentity ||
      current.evidenceIdentity !== proof.evidenceIdentity) throw new PrivateError("promotion_evidence_invalid");
  sameAssessment(original, current);
  if (await store.gatePromotionEvidenceIdentity([original.experimentId, ...original.development.map(d => d.experimentId)]) !== proof.retainedEvidenceIdentity) throw new PrivateError("promotion_evidence_invalid");
  return promotion;
}
export async function revalidateSavedGatePromotion(options: { store: PrivateStore; datasetDir: string; manifest: DatasetManifest; crypto: PrivateCrypto; configurationFingerprint: string }) {
  const { store } = options;
  const { promotion, original } = await historicalPromotion(store, options.configurationFingerprint);
  const retainedEvidenceIdentity = await store.gatePromotionEvidenceIdentity([original.experimentId, ...original.development.map(d => d.experimentId)]);
  const provider = createValidationOnlySystemOneAdapter();
  const readOnly = { ...store, savePromotionAssessment: async () => {}, readAttempt: async (id: string) => {
    const attempt = await store.readAttempt(id);
    if (attempt?.stage !== "appropriateness") throw new PrivateError("trial_evidence_mismatch");
    if (attempt.requests.some(r => (r.verifications?.length ?? 0) !== 0)) throw new PrivateError("promotion_evidence_invalid");
    const response = attempt.requests.at(-1)?.response;
    if (attempt.status === "valid" && (!response || provider.classify(response).kind !== "reply")) throw new PrivateError("trial_evidence_mismatch");
    return attempt;
  } };
  const current = await assessSavedPromotion({ ...options, store: readOnly, experimentId: original.experimentId });
  sameAssessment(original, current);
  // Reconstruct the historical representation only after proving every omitted
  // array is empty. Actual verification evidence is never removed from a hash.
  const historical = await assessSavedPromotion({ ...options, experimentId: original.experimentId, store: { ...readOnly,
    readAttempt: async id => {
      const attempt = await readOnly.readAttempt(id);
      return { ...attempt, requests: attempt.requests.map(({ verifications: _empty, ...request }) => request) };
    } } });
  if (historical.evidenceIdentity !== original.evidenceIdentity) throw new PrivateError("promotion_evidence_invalid");
  if (await store.gatePromotionEvidenceIdentity([original.experimentId, ...original.development.map(d => d.experimentId)]) !== retainedEvidenceIdentity) throw new PrivateError("promotion_evidence_invalid");
  if ((await store.currentPromotion(options.configurationFingerprint))?.id !== promotion.id) throw new PrivateError("promotion_changed");
  const material = { schema: "wordwell-gate-compatibility-v1", kind: "promotion", subjectId: promotion.id,
    originalIdentity: original.ruleIdentity, currentIdentity: current.ruleIdentity, evidenceIdentity: current.evidenceIdentity,
    originalAssessmentId: original.id, currentAssessmentId: current.id, retainedEvidenceIdentity, policyIdentity: gateCompatibilityPolicyIdentity(), modelCalls: 0 };
  const proof = parseGateCompatibility({ ...material, id: fingerprint(material) });
  await store.savePromotionAssessment({ ...current, material: current });
  await store.saveGateCompatibility({ ...proof, material: proof });
  await requireGatePromotion(store, options.configurationFingerprint);
  return proof;
}
