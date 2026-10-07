// Load the existing #11 owner decision. This is not a new promotion assessment.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import source from "../config/usefulness-combiner-e9d29c215805.json" with { type: "json" };
import promoted from "../config/usefulness-combiner-effc8eb93ba0.json" with { type: "json" };
import { PRODUCTION_COMBINER } from "./stages/usefulness-production.js";
import { createUsefulnessStage, loadCombiner, usefulnessConfiguration } from "./stages/usefulness.js";
import { fingerprint } from "./config.js";
import { PrivateError } from "./storage/crypto.js";
import type { PrivateStore } from "./storage/postgres.js";

export function approvedUsefulnessMaterial() {
  const original = loadCombiner(source), selected = PRODUCTION_COMBINER;
  const { id: _sourceId, threshold: _sourceThreshold, ...weights } = original;
  const { id: _selectedId, threshold: _selectedThreshold, ...selectedWeights } = selected;
  if (original.threshold !== 0.50 || selected.threshold !== 0.58 || !isDeepStrictEqual(weights, selectedWeights) ||
      fingerprint(promoted.threshold_selection) !== selected.id) throw new PrivateError("usefulness_promotion_evidence_invalid");
  const configuration = usefulnessConfiguration(selected);
  // This exact measured material is covered by the recorded #11 decision.
  // Editing questions or fit files cannot inherit that decision through a loader.
  if (createUsefulnessStage(configuration).fingerprint !== "580e7b73c45cf21936d5d7936bb5afadc1e2508562749aa060e3154cadb63170" ||
      fingerprint(source) !== "e9f02ede92fa1dd34a2f90b00091565958efa12179dad9db32c106965203381d" ||
      fingerprint(promoted) !== "46ca4dbfbcf60e3fa157c0c8fc47189ef1bed59342da696c99994b298753153c") throw new PrivateError("usefulness_promotion_evidence_invalid");
  return { schema: "wordwell-recorded-usefulness-promotion-v1", stage: "usefulness", decision: "promote",
    decisionReference: "https://github.com/cwebley/word-well/issues/11#issuecomment-5940925373",
    evidenceReference: "https://github.com/cwebley/word-well/issues/11#issuecomment-5941058012",
    configuration, configurationFingerprint: createUsefulnessStage(configuration).fingerprint,
    sourceArtifactIdentity: fingerprint(source), promotedArtifactIdentity: fingerprint(promoted) };
}
export async function recordApprovedUsefulnessPromotion(store: PrivateStore) {
  const material = approvedUsefulnessMaterial();
  const existing = await store.currentPromotion(material.configurationFingerprint);
  if (existing?.decision === "promote" && isDeepStrictEqual(existing.material, material)) return existing;
  if (existing) throw new PrivateError("usefulness_promotion_conflict");
  const id = randomUUID();
  await store.recordPromotion({ id, stage: "usefulness", configurationFingerprint: material.configurationFingerprint, decision: "promote", material });
  return { id, decision: "promote", material };
}
export async function requireUsefulnessPromotion(store: PrivateStore, configurationFingerprint: string) {
  const material = approvedUsefulnessMaterial();
  const saved = await store.currentPromotion(configurationFingerprint);
  if (!saved || saved.decision !== "promote") throw new PrivateError("configuration_not_promoted");
  if (configurationFingerprint !== material.configurationFingerprint || !isDeepStrictEqual(saved.material, material)) throw new PrivateError("usefulness_promotion_evidence_invalid");
  return saved;
}
