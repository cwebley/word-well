import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fingerprint, type PipelineConfig } from "../config.js";
import { bundleFilterInput, evaluateFilters, generationEvidence } from "../intake.js";
import { readScopedEvidence } from "./bundle.js";
import type { SourceStore } from "../storage/sources.js";
import { PrivateError } from "../storage/crypto.js";

async function identities(paths: string[]) {
  return Promise.all(paths.map(async path => ({ path, sha256: fingerprint(await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8")) })));
}
export async function importScopedBundle(store: SourceStore, options: { scope: string; manifest: string; directory?: string; limit?: number }) {
  const intention = { scope: JSON.parse(await readFile(options.scope, "utf8")), manifest: JSON.parse(await readFile(options.manifest, "utf8")),
    implementation: await identities(["./scoped_bundle.py", "./bundle.ts", "../storage/sources.ts", "../config.ts"]) };
  return store.importBundle({ id: fingerprint(intention), intention, load: () => readScopedEvidence({ directory: options.directory, scope: intention.scope, manifest: intention.manifest }), limit: options.limit });
}
export async function intakeConfigurationIdentity(config: PipelineConfig) {
  return fingerprint({ config, implementation: await identities(["../intake.ts", "../config.ts"]) });
}
export async function buildScopedCandidate(store: SourceStore, bundleId: string, config: PipelineConfig) {
  const bundle = await store.readyBundle(bundleId);
  const input = bundleFilterInput(bundle);
  const assessment = evaluateFilters(input, config);
  // Resolutions remain inspectable, even when a prerequisite is unresolved.
  return store.assess({ bundleId, headword: bundle.coverage.candidates[0], configFingerprint: await intakeConfigurationIdentity(config), resolution: input.resolution,
    assessment: { ...assessment, effectiveConfiguration: config, sourceSelection: bundleId, input, gateVerdict: null } });
}
export async function explainScopedCandidate(store: SourceStore, bundleId: string, headword: string, config: PipelineConfig) {
  const bundle = await store.readyBundle(bundleId);
  if (bundle.coverage.candidates[0] !== headword) throw new PrivateError("candidate_outside_bundle_scope");
  const explanation = await store.explanation(bundleId, headword, await intakeConfigurationIdentity(config));
  return { ...explanation, coverage: bundle.coverage, diagnostics: bundle.diagnostics,
    evidence: { entries: bundle.entries.map(e => ({ source: e.source, id: e.id, order: e.order, pos: e.pos, role: e.role, rawSha256: e.rawSha256, locator: e.locator })),
      meanings: bundle.meanings, relations: bundle.relations, supplemental: bundle.supplemental, frequency: bundle.frequency }, generationEvidence: generationEvidence(bundle) };
}

// Downstream stages must use an explicit selection and a current assessment.
// This check authorizes intake only. Gate promotion and paid execution are later.
export async function authorizeScopedCandidate(store: SourceStore, bundleId: string, config: PipelineConfig) {
  const bundle = await store.readyBundle(bundleId);
  const headword = bundle.coverage.candidates[0];
  const result = await store.explanation(bundleId, headword, await intakeConfigurationIdentity(config));
  if (result.assessment.disposition !== "pass") throw new PrivateError("candidate_intake_not_passing");
  return { bundleId, candidateId: result.candidateId, lessonId: result.lessonId, assessmentId: result.assessmentId, headword,
    appropriatenessInput: { headword },
    // Match the measured OEWN POS representation. Linked contrast/family entries
    // and Wiktionary-only POS are not the candidate's OEWN inventory.
    usefulnessInput: { headword, partsOfSpeech: [...new Set(bundle.entries.filter(e => e.source === "oewn" && e.role === "candidate" && e.headword === headword).map(e => e.pos).filter((pos): pos is string => !!pos))] } };
}
