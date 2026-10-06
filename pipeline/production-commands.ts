import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadPipelineConfig } from "./config.js";
import { createProductionCoordinator } from "./run.js";
import { PrivateError } from "./storage/crypto.js";
import { openLocalProductionStores, productionLedgerDirectory } from "./storage/production-local.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { createSystemOneAdapter } from "./execution/system-one.js";
import { loadLocalConfig } from "../evals/private-appropriateness.js";
import { APPROPRIATENESS_CONFIGURATION, createAppropriatenessStage } from "./stages/appropriateness.js";
import { authorizeScopedCandidate } from "./sources/index.js";
import { appropriatenessReuseIdentity } from "./reuse.js";

const local = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
export async function productionConfiguration() {
  return { configuration: APPROPRIATENESS_CONFIGURATION, configurationFingerprint: createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION).fingerprint,
    execution: loadLocalConfig(JSON.parse(await readFile(local("config/private-appropriateness.json"), "utf8"))) };
}
export async function executeProductionCommand(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    candidate: { type: "string" }, bundle: { type: "string" }, config: { type: "string" }, stage: { type: "string" },
    fresh: { type: "boolean" }, "dry-run": { type: "boolean" }, "max-cost-usd": { type: "string" }
  } });
  const [operation, runId] = positionals;
  if (operation !== "run" && !["resume", "recover", "inspect"].includes(operation)) throw new PrivateError("production_command_invalid");
  if (operation === "run") {
    if (positionals.length !== 1 || !values.candidate || !/^[a-f0-9]{64}$/.test(values.bundle ?? "")) throw new PrivateError("explicit_candidate_bundle_required");
    if (values.stage && values.stage !== "appropriateness" || values.fresh && !values.stage) throw new PrivateError("production_mode_invalid");
  } else if (positionals.length !== 2 || !z.uuid().safeParse(runId).success || Object.keys(values).some(k => operation !== "resume" || k !== "config")) throw new PrivateError("production_command_option_invalid");
  const capNanoUsd = Number(values["max-cost-usd"]) * 1e9;
  if (operation === "run" && !values["dry-run"] && (!Number.isSafeInteger(capNanoUsd) || capNanoUsd <= 0)) throw new PrivateError("explicit_cap_required");
  const stores = await openLocalProductionStores();
  try {
    if (operation === "run" && values["dry-run"]) {
      const intake = await loadPipelineConfig(values.config ?? local("config/pipeline.yaml"));
      const candidate = await authorizeScopedCandidate(stores.sources, values.bundle!, intake);
      if (candidate.headword !== values.candidate) throw new PrivateError("candidate_outside_bundle_scope");
      const effective = await productionConfiguration();
      const selected = await stores.store.selectedProductionResult(candidate.candidateId);
      const reuseIdentity = await appropriatenessReuseIdentity(candidate.appropriatenessInput, APPROPRIATENESS_CONFIGURATION);
      return { ...candidate, ...effective, reuseIdentity, selectedResultId: selected?.id ?? null,
        contentMatches: selected?.reuseIdentity === reuseIdentity, ownerPromotion: await stores.store.currentPromotion(effective.configurationFingerprint),
        mode: values.stage ? "stage-only" : "normal", fresh: values.fresh ?? false, modelCalls: 0 };
    }
    const ledger = await createReceiptLedger({ directory: productionLedgerDirectory, checkout: local("") });
    const adapter = createSystemOneAdapter({ apiKey: process.env.OPENROUTER_API_KEY ?? "read-only-no-key" });
    const coordinator = createProductionCoordinator({ ...stores, ledger, currentIntake: () => loadPipelineConfig(values.config ?? local("config/pipeline.yaml")),
      beforeDispatch: async () => { if (!process.env.OPENROUTER_API_KEY) throw new PrivateError("model_key_required"); }, execution: { kind: "live", model: {
      ...adapter, send: async (body, settings) => {
        if (operation === "inspect" || operation === "recover") throw new PrivateError("dispatch_forbidden");
        return adapter.send(body, settings);
      }
    } } });
    if (operation === "inspect") return await coordinator.inspect(runId);
    if (operation === "recover") return await coordinator.recover(runId);
    if (operation === "resume") return await coordinator.run(runId);
    const effective = await productionConfiguration();
    const id = await coordinator.create({ bundleId: values.bundle!, candidate: values.candidate!, intake: await loadPipelineConfig(values.config ?? local("config/pipeline.yaml")),
      config: effective.execution, capNanoUsd, fresh: values.fresh, stageOnly: !!values.stage });
    try {
      const report = await coordinator.run(id);
      return { runId: id, status: report.status, outcomeCode: report.outcomeCode, selectedResultId: report.selected?.id, spend: report.spend };
    } catch (error) {
      const ownerRunId = await stores.store.readProductionRun(id).then(async r => r ? await stores.store.candidateClaim(r.candidateId) : null).catch(() => null);
      throw new PrivateError(error instanceof PrivateError ? error.code : "production_run_failed", { runId: id, ...(ownerRunId ? { ownerRunId } : {}) });
    }
  } finally { await stores.close(); }
}
