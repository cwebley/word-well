import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadPipelineConfig } from "./config.js";
import { createWriterCoordinator } from "./writer-run.js";
import { createPlannerCoordinator } from "./planner-run.js";
import { createProductionCoordinator } from "./run.js";
import { createLunaAdapter } from "./execution/openrouter.js";
import { createSystemOneAdapter } from "./execution/system-one.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { productionLedgerDirectory } from "./storage/production-local.js";
import { openLocalWriterStores } from "./storage/writer-local.js";
import { WRITER_CONFIGURATION } from "./stages/writer.js";
import { PLANNER_CONFIGURATION } from "./stages/planner.js";
import { PrivateError } from "./storage/crypto.js";
import { verifyLunaSetup } from "./execution/luna-setup.js";

export async function executeWriterCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { candidate: { type: "string" }, bundle: { type: "string" },
    config: { type: "string" }, "dry-run": { type: "boolean" }, fresh: { type: "boolean" }, "max-cost-usd": { type: "string" } } });
  if (positionals.length !== 1 || positionals[0] !== "run" || !values.candidate || !/^[a-f0-9]{64}$/.test(values.bundle ?? "")) throw new PrivateError("writer_command_invalid");
  const capNanoUsd = Number(values["max-cost-usd"]) * 1e9;
  if (!values["dry-run"] && (!Number.isSafeInteger(capNanoUsd) || capNanoUsd <= 0)) throw new PrivateError("explicit_cap_required");
  return executeWriterProduction({ operation: "run", candidate: values.candidate, bundleId: values.bundle, configPath: values.config,
    dryRun: values["dry-run"], fresh: values.fresh, stageOnly: false, capNanoUsd });
}
export async function executeWriterProduction(options: { operation: string; runId?: string; candidate?: string; bundleId?: string; configPath?: string;
  dryRun?: boolean; fresh?: boolean; stageOnly?: boolean; capNanoUsd?: number }) {
  const local = await openLocalWriterStores();
  try {
    const currentIntake = () => loadPipelineConfig(options.configPath ?? fileURLToPath(new URL("../config/pipeline.yaml", import.meta.url)));
    const ledger = await createReceiptLedger({ directory: productionLedgerDirectory, checkout: fileURLToPath(new URL("../", import.meta.url)) });
    const gates = createProductionCoordinator({ ...local, ledger, currentIntake, execution: { kind: "live", model: createSystemOneAdapter({ apiKey: "authorization-only" }) } });
    const model = createLunaAdapter({ apiKey: process.env.OPENROUTER_API_KEY });
    const planner = createPlannerCoordinator({ ...local, ledger, currentIntake, executionKind: "live", model,
      authorizeGates: (bundleId, intake) => gates.authorizeDownstream({ bundleId, intake }) });
    const writer = createWriterCoordinator({ ...local, ledger, currentIntake, executionKind: "live", model,
      authorizePlan: async bundleId => { const { resultId, ...authorization } = await planner.authorizeWriter(bundleId, PLANNER_CONFIGURATION); return { ...authorization, usefulnessResultId: resultId }; },
      beforeDispatch: async () => {
        if (!process.env.OPENROUTER_API_KEY || options.operation === "inspect" || options.operation === "recover") throw new PrivateError("dispatch_forbidden");
        await verifyLunaSetup();
      } });
    if (options.operation === "inspect") return await writer.inspect(options.runId!);
    if (options.operation === "recover") return await writer.recover(options.runId!);
    if (options.operation === "resume") return await writer.run(options.runId!);
    if (options.dryRun) return await writer.dryRun(options.bundleId!, options.candidate!, WRITER_CONFIGURATION);
    const id = await writer.create({ bundleId: options.bundleId!, candidate: options.candidate!, configuration: WRITER_CONFIGURATION, fresh: options.fresh, stageOnly: options.stageOnly, capNanoUsd: options.capNanoUsd! });
    try { return await writer.run(id); }
    catch (error) { throw new PrivateError(error instanceof PrivateError ? error.code : "writer_run_failed", { runId: id }); }
  } finally { await local.close(); }
}
