// Saved generation validation has no connections or model adapter. Callers own
// the reads, so publication can supply records from its transaction client.
import { z } from "zod";
import { fingerprint, pipelineConfigSchema } from "./config.js";
import { lunaExecutionSchema } from "./planner-config.js";
import { checkPlan, createPlannerStage, planSchema, plannerInputSchema, plannerConfigurationSchema, type PlannerInput, type PlannerConfiguration } from "./stages/planner.js";
import { checkWrittenLesson, createWriterStage, writerResultSchema, writerInputSchema, writerConfigurationSchema, type WriterInput, type WriterConfiguration } from "./stages/writer.js";
import { assembleWrittenLesson } from "./sources/writer.js";
import { plannerReuseIdentity } from "./planner-identity.js";
import { writerReuseIdentity } from "./writer-identity.js";
import { latestResponse, type AttemptRecord, type PrivateStore } from "./storage/postgres.js";
import { PrivateError } from "./storage/crypto.js";

const plannerDependenciesSchema = z.object({ assessmentId: z.string(), appropriatenessResultId: z.uuid(), usefulnessResultId: z.uuid() }).strict();
export const plannerRunSchema = z.object({ schema: z.literal("wordwell-planner-run-v1"), stage: z.literal("planner"), mode: z.enum(["normal", "stage-only"]), fresh: z.boolean(),
  executionKind: z.enum(["live", "controlled"]), candidateId: z.uuid(), bundleId: z.string(), input: plannerInputSchema, configuration: plannerConfigurationSchema,
  intake: pipelineConfigSchema, execution: lunaExecutionSchema, implementation: z.string(), reuseIdentity: z.string(), originalDependencies: plannerDependenciesSchema }).strict();
export const plannerSavedResultSchema = z.object({ schema: z.literal("wordwell-production-planner-v1"), executionKind: z.enum(["live", "controlled"]), input: plannerInputSchema,
  configurationFingerprint: z.string(), attemptId: z.uuid(), originalDependencies: plannerDependenciesSchema, plan: planSchema }).strict();

const writerDependenciesSchema = z.object({ assessmentId: z.string(), appropriatenessResultId: z.uuid(), usefulnessResultId: z.uuid(), plannerResultId: z.uuid() }).strict();
export const writerRunSchema = z.object({ schema: z.literal("wordwell-writer-run-v1"), stage: z.literal("writer"), mode: z.enum(["normal", "stage-only"]), fresh: z.boolean(),
  executionKind: z.enum(["live", "controlled"]), candidateId: z.uuid(), bundleId: z.string(), input: writerInputSchema, configuration: writerConfigurationSchema,
  intake: pipelineConfigSchema, execution: lunaExecutionSchema, implementation: z.string(), reuseIdentity: z.string(), originalDependencies: writerDependenciesSchema }).strict();
export const writerSavedResultSchema = z.object({ schema: z.literal("wordwell-production-writer-v1"), executionKind: z.enum(["live", "controlled"]), input: writerInputSchema,
  configurationFingerprint: z.string(), attemptId: z.uuid(), originalDependencies: writerDependenciesSchema, written: writerResultSchema, assembled: z.unknown() }).strict();

type SelectedResult = NonNullable<Awaited<ReturnType<PrivateStore["selectedProductionResult"]>>>;
type SavedRun = Pick<NonNullable<Awaited<ReturnType<PrivateStore["readProductionRun"]>>>, "id" | "candidateId" | "status" | "material">;
type Evidence<I, C> = { selected: SelectedResult; run: SavedRun | null; attempt: AttemptRecord | null;
  candidateId: string; expectedInput: I; configuration: C; executionKind: "live" | "controlled" };

export async function validateSavedPlannerResult(value: Evidence<PlannerInput, PlannerConfiguration>) {
  const { selected, run, attempt, expectedInput: input, configuration: config, executionKind, candidateId } = value;
  const fail = () => { throw new PrivateError("planner_result_not_valid"); };
  const parsed = plannerSavedResultSchema.safeParse(selected.material), saved = plannerRunSchema.safeParse(run?.material);
  if (!parsed.success || !saved.success) return fail();
  const result = parsed.data, material = saved.data, stage = createPlannerStage(config, input);
  const last = attempt?.requests.at(-1), reply = last ? latestResponse(last) : null;
  const raw = reply?.kind === "response" ? stage.validate(reply.body) : null;
  const identity = await plannerReuseIdentity(input, config);
  // Empty valid plans are selected as rejected and remain reusable. Whether
  // a plan may feed the writer is a separate authorization check.
  const expectedStatus = result.plan.meanings.length ? "accepted" : "rejected";
  if (!run || run.id !== selected.runId || run.status !== expectedStatus || run.candidateId !== candidateId || material.candidateId !== candidateId ||
    material.executionKind !== executionKind || material.bundleId !== input.bundleId || fingerprint(material.input) !== fingerprint(input) ||
    fingerprint(material.configuration) !== fingerprint(config) || material.reuseIdentity !== identity || selected.reuseIdentity !== identity ||
    fingerprint(material.originalDependencies) !== fingerprint(result.originalDependencies) || result.executionKind !== executionKind ||
    fingerprint(result.input) !== fingerprint(input) || result.configurationFingerprint !== stage.fingerprint ||
    !attempt || attempt.id !== result.attemptId || attempt.status !== "valid" || attempt.runId !== selected.runId || attempt.stage !== "planner" ||
    fingerprint(attempt.input.input) !== fingerprint(input) || fingerprint(attempt.input.request) !== fingerprint(stage.render(input)) ||
    fingerprint(attempt.input.provenance) !== fingerprint(result.originalDependencies) || !raw?.ok ||
    fingerprint(raw.result) !== fingerprint(result.plan) || fingerprint(attempt.result) !== fingerprint(result.plan)) return fail();
  return { ...result, plan: checkPlan(input, result.plan) };
}

export async function validateSavedWriterResult(value: Evidence<WriterInput, WriterConfiguration>) {
  const { selected, run, attempt, expectedInput: input, configuration: config, executionKind, candidateId } = value;
  const fail = () => { throw new PrivateError("writer_result_not_valid"); };
  const parsed = writerSavedResultSchema.safeParse(selected.material), saved = writerRunSchema.safeParse(run?.material);
  if (!parsed.success || !saved.success) return fail();
  const result = parsed.data, material = saved.data, stage = createWriterStage(config, input);
  const last = attempt?.requests.at(-1), reply = last ? latestResponse(last) : null;
  const raw = reply?.kind === "response" ? stage.validate(reply.body) : null;
  const identity = await writerReuseIdentity(input, config);
  if (!run || run.id !== selected.runId || run.status !== "accepted" || run.candidateId !== candidateId || material.candidateId !== candidateId ||
    material.executionKind !== executionKind || material.bundleId !== input.bundleId || fingerprint(material.input) !== fingerprint(input) ||
    fingerprint(material.configuration) !== fingerprint(config) || material.reuseIdentity !== identity || selected.reuseIdentity !== identity ||
    fingerprint(material.originalDependencies) !== fingerprint(result.originalDependencies) || result.executionKind !== executionKind ||
    fingerprint(result.input) !== fingerprint(input) || result.configurationFingerprint !== stage.fingerprint ||
    !attempt || attempt.id !== result.attemptId || attempt.status !== "valid" || attempt.runId !== selected.runId || attempt.stage !== "writer" ||
    fingerprint(attempt.input.input) !== fingerprint(input) || fingerprint(attempt.input.request) !== fingerprint(stage.render(input)) ||
    fingerprint(attempt.input.provenance) !== fingerprint(result.originalDependencies) || !raw?.ok ||
    fingerprint(raw.result) !== fingerprint(result.written) || fingerprint(attempt.result) !== fingerprint(result.written) ||
    fingerprint(result.assembled) !== fingerprint(assembleWrittenLesson(input, result.written))) return fail();
  return { ...result, written: checkWrittenLesson(input, result.written) };
}
