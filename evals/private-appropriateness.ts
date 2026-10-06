// Private appropriateness evaluation (#15). Loads a frozen encrypted dataset,
// keeps owner expectations with the scorer, runs three trials per case through
// the shared stage and executor, and saves encrypted outcomes and scores.
// No hosted evaluation, tracing or telemetry is imported here.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createStageExecutor, type ExecutionSettings } from "../pipeline/execution/executor.js";
import type { ModelAdapter } from "../pipeline/execution/model.js";
import { CONFIGURATIONS, configurationSchema, createAppropriatenessStage, resultSchema, thresholdsFor, TRIALS, type AppropriatenessConfiguration } from "../pipeline/stages/appropriateness.js";
import { digest, PrivateError, type PrivateCrypto } from "../pipeline/storage/crypto.js";
import type { PrivateStore } from "../pipeline/storage/postgres.js";
import { atomicWrite, privateDirectory } from "../pipeline/storage/files.js";
import type { ReceiptLedger } from "../pipeline/storage/receipts.js";
import { loadFrozenDataset, type DatasetManifest } from "./authoring/store.js";
import { scoreCase, summarize, type CaseScore, type ExperimentSummary, type TrialOutcome } from "./scorers/appropriateness.js";
import { buildSummary, parseSummary, summaryDigest } from "./summarize.js";
import { outcomeFromAttempt, runTrial, trialOutcome } from "./trials.js";

const checkout = fileURLToPath(new URL("../", import.meta.url));
const localConfigSchema = z.object({
  schema: z.literal("wordwell-private-appropriateness-config-v1"),
  execution: z.object({
    requestTimeoutSeconds: z.number().int().min(1).max(600),
    maxTransportRetries: z.number().int().min(0).max(2),
    retryDelaysSeconds: z.array(z.number().min(0).max(60)).max(2),
    maxRetryWaitSeconds: z.number().int().min(0).max(600)
  }).strict().refine(e => e.retryDelaysSeconds.length === e.maxTransportRetries, "one delay per retry"),
  pricing: z.object({
    status: z.enum(["unverified", "verified"]),
    inputNanoUsdPerToken: z.number().int().positive(),
    contextTokens: z.number().int().positive().max(1_000_000),
    requestFeeNanoUsd: z.number().int().nonnegative(),
    evidence: z.string().max(2000)
  }).strict()
}).strict();
export type LocalConfig = z.infer<typeof localConfigSchema>;
export const loadLocalConfig = (value: unknown): LocalConfig => localConfigSchema.parse(value);

const settingsSchema: z.ZodType<ExecutionSettings> = z.object({
  requestTimeoutMs: z.number().int().positive(), maxTransportRetries: z.number().int().min(0).max(2),
  retryDelaysMs: z.array(z.number().int().nonnegative()), maxRetryWaitMs: z.number().int().nonnegative(),
  reservationNanoUsd: z.number().int().positive()
}).strict();
const implementationSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), gitRevision: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  lockSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type ImplementationIdentity = z.infer<typeof implementationSchema>;
const materialSchema = z.object({
  schema: z.literal("wordwell-private-experiment-v1"),
  configuration: configurationSchema,
  settings: settingsSchema,
  pricing: localConfigSchema.shape.pricing,
  dataset: z.object({ id: z.uuid(), version: z.number().int().positive(), contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  implementation: implementationSchema,
  // Smoke runs use harmless stand-in words and never count as evaluation.
  purpose: z.enum(["evaluation", "smoke", "audit"]).default("evaluation"),
  // Membership: the whole frozen dataset, or one split of it.
  split: z.enum(["all", "development", "held-out"]).default("all")
}).strict();

// Code whose behavior an experiment's saved evidence depends on. Resume
// refuses a different identity rather than silently adopting current files.
const IMPLEMENTATION_FILES = [
  "pipeline/stages/appropriateness.ts", "pipeline/execution/executor.ts", "pipeline/execution/model.ts",
  "pipeline/execution/stage.ts", "pipeline/execution/system-one.ts", "pipeline/storage/postgres.ts",
  "pipeline/storage/receipts.ts", "pipeline/storage/crypto.ts", "pipeline/storage/files.ts",
  "evals/trials.ts", "evals/scorers/appropriateness.ts", "evals/authoring/store.ts", "evals/authoring/records.ts",
  "evals/private-appropriateness.ts", "package-lock.json"
];

export async function implementationIdentity(): Promise<ImplementationIdentity> {
  const parts = await Promise.all(IMPLEMENTATION_FILES.map(async path => `${path}\0${digest(await readFile(resolve(checkout, path)))}`));
  let gitRevision: string | null = null;
  try { gitRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { gitRevision = null; }
  return implementationSchema.parse({
    fingerprint: digest(parts.join("\n")),
    gitRevision: /^[a-f0-9]{40}$/.test(gitRevision ?? "") ? gitRevision : null,
    lockSha256: digest(await readFile(resolve(checkout, "package-lock.json")))
  });
}

export type CaseResult = {
  caseId: string; headword: string;
  expected: "clear" | "blocked"; reason: string; split: "development" | "held-out";
  trials: {
    trialIndex: number; state: TrialOutcome["state"] | "pending" | "missing"; code: string | null;
    blockedProbability: number | null; slurProbability: number | null; vulgarProbability: number | null; disposition: "accept" | "reject" | null; physicalRequests: number;
    // Raw provider exchanges, decrypted, for local inspection only.
    requests: { sequence: number; status: string; httpStatus: number | null; body: string | null }[];
  }[];
  score: ReturnType<typeof scoreCase>;
};
export type RunReport = {
  stopped: null | { state: string; code?: string; nextEligibleAt?: string };
  summary: ExperimentSummary;
  spend: Awaited<ReturnType<PrivateStore["spend"]>>;
  complete: boolean;
};

// Read-only view of saved experiments: status, per-case detail and saved
// configuration. Needs no ledger or model adapter, and makes zero model calls.
export function createPrivateAppropriatenessReader(store: PrivateStore) {
  // Rescores every case from its saved terminal trial outcomes, with the
  // experiment's saved thresholds and the current pass rule. Zero model calls.
  async function currentScores(experimentId: string) {
    const experiment = await store.readExperiment(experimentId);
    if (!experiment) throw new PrivateError("experiment_missing");
    const thresholds = thresholdsFor(materialSchema.parse(experiment.material).configuration);
    const expectations = await store.readExpectations(experimentId);
    const trials = await store.listTrials(experimentId);
    const scores = new Map<string, CaseScore>();
    for (const [caseId, expected] of expectations) {
      const outcomes: TrialOutcome[] = [];
      for (const trial of trials.filter(t => t.caseId === caseId).sort((a, b) => a.trialIndex - b.trialIndex)) {
        const attempt = await store.readAttempt(trial.attemptId);
        const outcome = attempt ? outcomeFromAttempt(attempt) : null;
        if (!outcome) break;
        outcomes.push(outcome);
      }
      scores.set(caseId, scoreCase(expected.finding, outcomes, thresholds));
    }
    return scores;
  }

  // Counts and amounts only.
  async function status(experimentId: string): Promise<Omit<RunReport, "stopped">> {
    const summary = summarize([...(await currentScores(experimentId)).values()]);
    return { summary, spend: await store.spend(experimentId), complete: summary.missingTrials === 0 };
  }

  return {
    status,
    // Saved configuration and identities for display. Zero model calls.
    async describe(experimentId: string) {
      const experiment = await store.readExperiment(experimentId);
      if (!experiment) throw new PrivateError("experiment_missing");
      const material = materialSchema.parse(experiment.material);
      return { id: experiment.id, createdAt: experiment.createdAt, dataset: experiment.dataset, capNanoUsd: experiment.capNanoUsd,
        configurationFingerprint: experiment.configurationFingerprint,
        requestedModel: material.configuration.requestedModel, pinnedModel: material.configuration.pinnedModel,
        questionId: material.configuration.questionId, pricingStatus: material.pricing.status, split: material.split, purpose: material.purpose,
        // Display name of a known configuration; older or edited wording shows its fingerprint.
        configurationName: Object.entries(CONFIGURATIONS).find(([, c]) => createAppropriatenessStage(c).fingerprint === experiment.configurationFingerprint)?.[0]
          ?? `custom ${experiment.configurationFingerprint.slice(0, 12)}` };
    },

    // Per-case decrypted detail for local inspection. Zero model calls.
    // Contains private text: never log it for a real dataset.
    async caseResults(experimentId: string): Promise<CaseResult[]> {
      const expectations = await store.readExpectations(experimentId);
      const scores = await currentScores(experimentId);
      const trials = await store.listTrials(experimentId);
      return Promise.all((await store.readCases(experimentId)).map(async c => {
        const expected = expectations.get(c.caseId)!;
        const detail = await Promise.all(Array.from({ length: TRIALS }, (_, i) => i + 1).map(async trialIndex => {
          const trial = trials.find(t => t.caseId === c.caseId && t.trialIndex === trialIndex);
          const attempt = trial ? await store.readAttempt(trial.attemptId) : null;
          if (!attempt) return { trialIndex, state: "missing" as const, code: null, blockedProbability: null, slurProbability: null, vulgarProbability: null, disposition: null, physicalRequests: 0, requests: [] };
          const result = attempt.status === "valid" ? resultSchema.parse(attempt.result) : null;
          return {
            trialIndex, state: attempt.status, code: attempt.outcomeCode,
            blockedProbability: result?.blockedProbability ?? null, slurProbability: result?.slurProbability ?? null,
            vulgarProbability: result?.vulgarProbability ?? null, disposition: result?.disposition ?? null,
            physicalRequests: attempt.requests.filter(r => r.status !== "abandoned").length,
            requests: attempt.requests.filter(r => r.status !== "abandoned").map(r => ({ sequence: r.sequence, status: r.status, httpStatus: r.httpStatus,
              body: r.response?.kind === "response" ? r.response.body : null }))
          };
        }));
        return { caseId: c.caseId, headword: c.input.headword, expected: expected.finding, reason: expected.reason, split: expected.split,
          trials: detail, score: scores.get(c.caseId) ?? scoreCase(expected.finding, []) };
      }));
    }
  };
}

export function createPrivateAppropriatenessRunner(deps: {
  store: PrivateStore;
  ledger: ReceiptLedger;
  // Adapters by configuration route. A future configuration names its route.
  models: Record<string, ModelAdapter>;
  implementation: ImplementationIdentity;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  // Internal filesystem fault-injection seam, not another summary format.
  writeSummary?: typeof atomicWrite;
}) {
  const { store } = deps;
  const reader = createPrivateAppropriatenessReader(store);
  const { status } = reader;

  return {
    ...reader,

    // Records fixed instructions, cap and frozen cases. Makes no model call.
    async create(options: {
      datasetDir: string; manifest: DatasetManifest; datasetCrypto: PrivateCrypto;
      capNanoUsd: number; configuration: AppropriatenessConfiguration; config: LocalConfig; purpose?: "evaluation" | "smoke" | "audit";
      split?: "development" | "held-out";
    }): Promise<string> {
      if (!Number.isSafeInteger(options.capNanoUsd) || options.capNanoUsd <= 0) throw new PrivateError("cap_invalid");
      const config = localConfigSchema.parse(options.config);
      const stage = createAppropriatenessStage(options.configuration);
      const dataset = await loadFrozenDataset(options.datasetDir, options.manifest, options.datasetCrypto);
      if (options.split && !dataset.cases.some(c => c.split === options.split)) throw new PrivateError("split_empty");
      const id = randomUUID();
      const { execution, pricing } = config;
      await store.createExperiment({
        id, stage: stage.name,
        dataset: { id: dataset.id, version: dataset.version, ciphertextSha256: options.manifest.ciphertextSha256 },
        configurationFingerprint: stage.fingerprint, implementationFingerprint: deps.implementation.fingerprint,
        capNanoUsd: options.capNanoUsd,
        material: materialSchema.parse({
          schema: "wordwell-private-experiment-v1", configuration: stage.configuration,
          settings: {
            requestTimeoutMs: execution.requestTimeoutSeconds * 1000, maxTransportRetries: execution.maxTransportRetries,
            retryDelaysMs: execution.retryDelaysSeconds.map(s => s * 1000), maxRetryWaitMs: execution.maxRetryWaitSeconds * 1000,
            reservationNanoUsd: pricing.contextTokens * pricing.inputNanoUsdPerToken + pricing.requestFeeNanoUsd
          },
          pricing, dataset: { id: dataset.id, version: dataset.version, contentIdentity: dataset.contentIdentity },
          purpose: options.purpose ?? "evaluation", split: options.split ?? "all",
          implementation: deps.implementation
        }),
        // Stage input and owner expectation stay separate ciphertexts.
        cases: [...dataset.cases].filter(c => !options.split || c.split === options.split)
          .sort((a, b) => a.id.localeCompare(b.id)).map((c, position) => ({
          caseId: c.id, position, input: { headword: c.content.headword },
          expectation: { finding: c.content.finding!, reason: c.content.reason, split: c.split! }
        }))
      });
      return id;
    },

    // Runs or resumes. Saved terminal outcomes, including failures, are kept;
    // a new non-valid outcome or a blocked attempt stops further dispatch.
    async run(experimentId: string): Promise<RunReport> {
      const release = await store.lockExperiment(experimentId);
      try {
        const experiment = await store.readExperiment(experimentId);
        if (!experiment) throw new PrivateError("experiment_missing");
        if (experiment.finalizedAt) throw new PrivateError("experiment_finalized");
        const material = materialSchema.parse(experiment.material);
        if (experiment.implementationFingerprint !== deps.implementation.fingerprint ||
            material.implementation.fingerprint !== deps.implementation.fingerprint) throw new PrivateError("implementation_changed");
        const stage = createAppropriatenessStage(material.configuration);
        if (stage.fingerprint !== experiment.configurationFingerprint) throw new PrivateError("configuration_mismatch");
        const model = deps.models[material.configuration.route];
        if (!model) throw new PrivateError("model_adapter_unavailable");
        const executor = createStageExecutor({ store, ledger: deps.ledger, model, settings: material.settings, now: deps.now, sleep: deps.sleep });

        // Expectations stay with the scorer; the stage sees only c.input.
        const expectations = await store.readExpectations(experimentId);
        let stopped: RunReport["stopped"] = null;
        cases: for (const c of await store.readCases(experimentId)) {
          const expected = expectations.get(c.caseId);
          if (!expected) throw new PrivateError("expectation_missing");
          const outcomes: TrialOutcome[] = [];
          for (let trialIndex = 1; trialIndex <= TRIALS; trialIndex++) {
            await release.assert();
            const { outcome, previouslySaved } = await runTrial({ store, executor, stage, experimentId, caseId: c.caseId, trialIndex, input: c.input, assertOwnership: release.assert, ownership: release });
            const scored = trialOutcome(outcome);
            if (scored) {
              outcomes.push(scored);
              await store.saveCaseScore(experimentId, c.caseId, { caseScore: scoreCase(expected.finding, outcomes, thresholdsFor(material.configuration)) }, release);
            }
            if (outcome.state === "valid" || (previouslySaved && scored)) continue;
            stopped = outcome.state === "paused"
              ? { state: "paused", code: outcome.code, ...(outcome.nextEligibleAt ? { nextEligibleAt: outcome.nextEligibleAt } : {}) }
              : "code" in outcome ? { state: outcome.state, code: outcome.code } : { state: outcome.state };
            break cases;
          }
        }
        return { stopped, ...(await status(experimentId)) };
      } finally { await release(); }
    },


    // Freezes evidence and writes the aggregate-only summary outside the
    // checkout. Incomplete or failed experiments can finalize; they cannot pass.
    // Idempotent: a repeat returns the same artifact. Zero model calls.
    async finalize(experimentId: string, options: { summariesDir: string }): Promise<{ path: string; sha256: string }> {
      const release = await store.lockExperiment(experimentId);
      try {
        const experiment = await store.readExperiment(experimentId);
        if (!experiment) throw new PrivateError("experiment_missing");
        const material = materialSchema.parse(experiment.material);
        const current = await status(experimentId);
        const summary = experiment.frozenSummary ? parseSummary(experiment.frozenSummary) : buildSummary({
          experimentId, datasetId: experiment.dataset.id, datasetVersion: experiment.dataset.version,
          configurationFingerprint: experiment.configurationFingerprint, pinnedModel: material.configuration.pinnedModel,
          purpose: material.purpose, split: material.split, summary: current.summary, spend: current.spend,
          startedAt: experiment.createdAt, finishedAt: current.spend.lastCompletedAt ?? experiment.createdAt
        });
        const sha256 = summaryDigest(summary);
        if (experiment.finalizedAt && experiment.summarySha256 !== sha256) throw new PrivateError("summary_mismatch");
        const directory = await privateDirectory(options.summariesDir, checkout);
        const path = resolve(directory, `${experimentId}.json`);
        await release.assert();
        // Freeze the digest through the live lock session before publishing the
        // file. A failed file write can recreate this exact artifact on retry.
        if (!experiment.finalizedAt) await store.finalizeExperiment(experimentId, sha256, new Date(), release, summary);
        await (deps.writeSummary ?? atomicWrite)(path, Buffer.from(JSON.stringify(summary, null, 2) + "\n"));
        return { path, sha256 };
      } finally { await release(); }
    }
  };
}
