import { z } from "zod";
import { fingerprint } from "./config.js";
import { PrivateError } from "./storage/crypto.js";
import type { PrivateStore, AttemptRecord } from "./storage/postgres.js";
import type { PlannerRevalidationStore } from "./storage/planner-revalidations.js";
import type { ReceiptLedger } from "./storage/receipts.js";
import { createPlannerEvaluator, plannerEvaluationMaterial, plannerCoveragePass } from "../evals/planner.js";
import { createLunaAdapter } from "./execution/openrouter.js";
import { createPlannerStage, PLANNER_CONFIGURATION, planSchema, plannerConfigurationSchema, plannerInputSchema, type PlannerConfiguration } from "./stages/planner.js";
import { plannerImplementation } from "./planner-identity.js";
import { plannerPromotionRuleIdentity } from "./planner-promotion.js";

export const PLANNER_REVALIDATION_SCOPE = {
  sourceExperimentId: "b22c4dd3-a565-45e7-9802-b602bbeaf224",
  sourceImplementation: "d89c8abe42c6e5d81034abd243bf25d60a392958900d079cbff6f2368ea5d35e",
  sourceRuleIdentity: "bb53d5e8ef2e75bea99ac481a7b32d31607dd7c41d3decb629131aecbb8106da",
  sourceEvidenceIdentity: "159e3db77afdbbe54f057bf687e51bd376863330c09982548091f2be29196402",
  approvalReference: "https://github.com/cwebley/word-well/issues/28#issuecomment-6088340503"
} as const;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const approvalSchema = z.object({ reviewer: z.literal("local-owner"), reference: z.literal(PLANNER_REVALIDATION_SCOPE.approvalReference),
  sourceExperimentId: z.literal(PLANNER_REVALIDATION_SCOPE.sourceExperimentId), decision: z.literal("reuse-saved-answers"), modelCalls: z.literal(0) }).strict();
const trialSchema = z.object({ caseId: z.uuid(), trialIndex: z.number().int().min(1).max(3), attemptId: z.uuid(), requestId: z.uuid(),
  inputFingerprint: sha, requestFingerprint: sha, responseFingerprint: sha, chargeNanoUsd: z.number().int().nonnegative(),
  result: planSchema, resultFingerprint: sha, coveragePassed: z.literal(true) }).strict();
const bodySchema = z.object({ schema: z.literal("wordwell-planner-revalidation-v1"), sourceExperimentId: z.uuid(),
  sourceConfigurationFingerprint: sha, sourceImplementation: sha, sourceRuleIdentity: sha,
  sourceDataset: z.object({ id: z.uuid(), version: z.number().int().positive(), ciphertextSha256: sha, contentIdentity: sha }).strict(),
  sourceEvidenceIdentity: sha, configuration: plannerConfigurationSchema, configurationFingerprint: sha,
  implementation: sha, testedRuleIdentity: sha, approval: approvalSchema, trials: z.array(trialSchema).length(3), modelCalls: z.literal(0) }).strict();
export const plannerRevalidationSchema = bodySchema.extend({ id: sha }).strict();
export type PlannerRevalidation = z.infer<typeof plannerRevalidationSchema>;

function parseProof(value: unknown) {
  const proof = plannerRevalidationSchema.parse(value), { id, ...body } = proof;
  if (id !== fingerprint(body) || proof.sourceExperimentId !== PLANNER_REVALIDATION_SCOPE.sourceExperimentId ||
    proof.sourceImplementation !== PLANNER_REVALIDATION_SCOPE.sourceImplementation || proof.sourceRuleIdentity !== PLANNER_REVALIDATION_SCOPE.sourceRuleIdentity ||
    proof.sourceEvidenceIdentity !== PLANNER_REVALIDATION_SCOPE.sourceEvidenceIdentity ||
    proof.approval.sourceExperimentId !== proof.sourceExperimentId || new Set(proof.trials.map(t => t.attemptId)).size !== 3 ||
    new Set(proof.trials.map(t => t.requestId)).size !== 3 || new Set(proof.trials.map(t => t.caseId)).size !== 1 ||
    proof.trials.some((trial, index) => trial.trialIndex !== index + 1 || fingerprint(trial.result) !== trial.resultFingerprint))
    throw new PrivateError("planner_revalidation_invalid");
  return proof;
}

function recheckTrial(experimentId: string, configuration: PlannerConfiguration, suppliedInput: unknown, attempt: AttemptRecord | null) {
  const input = plannerInputSchema.parse(suppliedInput), request = attempt?.requests[0];
  if (!attempt || attempt.experimentId !== experimentId || attempt.stage !== "planner" || attempt.status !== "verification_unresolved" ||
    attempt.outcomeCode !== "luna_verification_unresolved" || attempt.result !== null || attempt.requests.length !== 1 ||
    request?.response?.kind !== "response" || request.httpStatus !== 200 || request.chargeStatus !== "known" || request.chargeNanoUsd === null ||
    (request.verifications?.length ?? 0) !== 0 || fingerprint(attempt.input.input) !== fingerprint(input))
    throw new PrivateError("planner_revalidation_source_invalid");
  const originalStage = createPlannerStage(configuration, input), original = originalStage.validate(request.response.body);
  const currentStage = createPlannerStage(PLANNER_CONFIGURATION, input), current = currentStage.validate(request.response.body);
  if (original.ok || original.code !== "luna_verification_unresolved" || !current.ok ||
    fingerprint(attempt.input.request) !== fingerprint(originalStage.render(input)) ||
    fingerprint(currentStage.render(input)) !== fingerprint(attempt.input.request)) throw new PrivateError("planner_revalidation_not_passing");
  return { request, result: current.result, configurationFingerprint: currentStage.fingerprint, inputFingerprint: fingerprint(input),
    requestFingerprint: fingerprint(attempt.input.request), responseFingerprint: fingerprint(request.response), resultFingerprint: fingerprint(current.result) };
}

export async function requirePlannerRevalidation(store: PrivateStore, revalidations: PlannerRevalidationStore, id: string) {
  const saved = await revalidations.read(id);
  if (!saved) throw new PrivateError("planner_revalidation_missing");
  const proof = parseProof(saved.material);
  if (fingerprint(saved) !== fingerprint({ id: proof.id, sourceExperimentId: proof.sourceExperimentId, configurationFingerprint: proof.configurationFingerprint,
    implementation: proof.implementation, ruleIdentity: proof.testedRuleIdentity, sourceEvidenceIdentity: proof.sourceEvidenceIdentity, material: proof }) ||
    proof.implementation !== await plannerImplementation() || proof.testedRuleIdentity !== await plannerPromotionRuleIdentity() ||
    fingerprint(proof.configuration) !== fingerprint(PLANNER_CONFIGURATION) ||
    await revalidations.sourceEvidenceIdentity(proof.sourceExperimentId) !== proof.sourceEvidenceIdentity)
    throw new PrivateError("planner_revalidation_stale");
  const experiment = await store.readExperiment(proof.sourceExperimentId);
  if (!experiment || experiment.configurationFingerprint !== proof.sourceConfigurationFingerprint || experiment.implementationFingerprint !== proof.sourceImplementation ||
    fingerprint(experiment.dataset) !== fingerprint({ id: proof.sourceDataset.id, version: proof.sourceDataset.version, ciphertextSha256: proof.sourceDataset.ciphertextSha256 }))
    throw new PrivateError("planner_revalidation_invalid");
  const sourceMaterial = plannerEvaluationMaterial.parse(experiment.material);
  if (sourceMaterial.implementation !== proof.sourceImplementation || sourceMaterial.testedRuleIdentity !== proof.sourceRuleIdentity ||
    sourceMaterial.datasetContentIdentity !== proof.sourceDataset.contentIdentity ||
    fingerprint(sourceMaterial.configuration) !== fingerprint({ ...proof.configuration, routingVerification: "completion-inline-strict-v1" }))
    throw new PrivateError("planner_revalidation_invalid");
  const cases = await store.readStageCases(proof.sourceExperimentId);
  if (cases.length !== 1) throw new PrivateError("planner_revalidation_invalid");
  for (const trial of proof.trials) {
    const source = cases.find(c => c.caseId === trial.caseId), attempt = await store.readAttempt(trial.attemptId);
    if (!source) throw new PrivateError("planner_revalidation_invalid");
    const checked = recheckTrial(proof.sourceExperimentId, sourceMaterial.configuration, source.input, attempt);
    if (checked.request.id !== trial.requestId || checked.request.chargeNanoUsd !== trial.chargeNanoUsd || checked.inputFingerprint !== trial.inputFingerprint ||
      checked.requestFingerprint !== trial.requestFingerprint || checked.responseFingerprint !== trial.responseFingerprint ||
      checked.configurationFingerprint !== proof.configurationFingerprint || checked.resultFingerprint !== trial.resultFingerprint)
      throw new PrivateError("planner_revalidation_invalid");
  }
  return proof;
}

export async function revalidatePlannerAnswers(options: { store: PrivateStore; revalidations: PlannerRevalidationStore; ledger: ReceiptLedger; approval: unknown }) {
  const approval = approvalSchema.parse(options.approval), { store, revalidations, ledger } = options;
  const evidenceBefore = await revalidations.sourceEvidenceIdentity(approval.sourceExperimentId);
  if (evidenceBefore !== PLANNER_REVALIDATION_SCOPE.sourceEvidenceIdentity) throw new PrivateError("planner_revalidation_source_changed");
  const evaluator = createPlannerEvaluator({ store, ledger, model: createLunaAdapter({ fetch: async () => { throw new PrivateError("dispatch_forbidden"); } }) });
  const source = await evaluator.inspect(approval.sourceExperimentId), experiment = await store.readExperiment(source.experimentId);
  if (!experiment || source.material.implementation !== PLANNER_REVALIDATION_SCOPE.sourceImplementation ||
    source.material.testedRuleIdentity !== PLANNER_REVALIDATION_SCOPE.sourceRuleIdentity || source.summary.cases !== 1 ||
    source.summary.requiredTrials !== 3 || source.summary.verificationUnresolvedTrials !== 3 || source.summary.splits.development !== 1 ||
    source.summary.splits.heldOut !== 0 || source.spend.physicalRequests !== 3 || source.spend.outstandingNanoUsd !== 0 || source.spend.unresolvedRequests !== 0 ||
    source.material.configuration.schema !== "wordwell-planner-configuration-v5" || source.material.configuration.routingVerification !== "completion-inline-strict-v1" ||
    fingerprint(source.material.configuration) !== fingerprint({ ...PLANNER_CONFIGURATION, routingVerification: "completion-inline-strict-v1" }))
    throw new PrivateError("planner_revalidation_source_invalid");
  const receipts = (await ledger.read()).filter(event => event.experimentId === source.experimentId);
  const trials = source.outcomes.map(outcome => {
    const checked = recheckTrial(source.experimentId, source.material.configuration, outcome.input, outcome.attempt), attempt = outcome.attempt!, request = checked.request;
    if (!plannerCoveragePass(checked.result, outcome.expectation)) throw new PrivateError("planner_revalidation_not_passing");
    const intent = receipts.filter(event => event.type === "dispatch_intent" && event.requestId === request.id && event.attemptId === attempt.id);
    const charged = receipts.filter(event => event.type === "request_outcome" && event.requestId === request.id && event.attemptId === attempt.id);
    if (intent.length !== 1 || charged.length !== 1 || charged[0].type !== "request_outcome" || charged[0].chargeStatus !== "known" ||
      charged[0].chargeNanoUsd !== request.chargeNanoUsd || charged[0].generationId !== request.generationId) throw new PrivateError("planner_revalidation_accounting_invalid");
    return { caseId: outcome.caseId, trialIndex: outcome.trialIndex, attemptId: attempt.id, requestId: request.id,
      inputFingerprint: checked.inputFingerprint, requestFingerprint: checked.requestFingerprint, responseFingerprint: checked.responseFingerprint,
      chargeNanoUsd: request.chargeNanoUsd, result: checked.result, resultFingerprint: checked.resultFingerprint, coveragePassed: true as const };
  });
  if (await revalidations.sourceEvidenceIdentity(source.experimentId) !== evidenceBefore) throw new PrivateError("planner_revalidation_source_changed");
  const body = bodySchema.parse({ schema: "wordwell-planner-revalidation-v1", sourceExperimentId: source.experimentId,
    sourceConfigurationFingerprint: source.configurationFingerprint, sourceImplementation: source.material.implementation, sourceRuleIdentity: source.material.testedRuleIdentity,
    sourceDataset: { ...experiment.dataset, contentIdentity: source.material.datasetContentIdentity }, sourceEvidenceIdentity: evidenceBefore,
    configuration: PLANNER_CONFIGURATION, configurationFingerprint: createPlannerStage(PLANNER_CONFIGURATION, source.outcomes[0].input).fingerprint,
    implementation: await plannerImplementation(), testedRuleIdentity: await plannerPromotionRuleIdentity(), approval, trials, modelCalls: 0 });
  const proof = parseProof({ ...body, id: fingerprint(body) });
  await revalidations.save({ id: proof.id, sourceExperimentId: proof.sourceExperimentId, configurationFingerprint: proof.configurationFingerprint,
    implementation: proof.implementation, ruleIdentity: proof.testedRuleIdentity, sourceEvidenceIdentity: proof.sourceEvidenceIdentity, material: proof });
  return requirePlannerRevalidation(store, revalidations, proof.id);
}
