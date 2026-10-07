import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadPipelineConfig } from "./config.js";
import { createPlannerCoordinator } from "./planner-run.js";
import { createProductionCoordinator } from "./run.js";
import { createLunaAdapter } from "./execution/openrouter.js";
import { createSystemOneAdapter } from "./execution/system-one.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { productionLedgerDirectory, openLocalProductionStores } from "./storage/production-local.js";
import { PLANNER_CONFIGURATION } from "./stages/planner.js";
import { PrivateError } from "./storage/crypto.js";
import { verifyLunaSetup } from "./execution/luna-setup.js";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

// Normal planner execution starts from selected gate acceptances. Gate-only
// commands retain their existing endpoint; missing gates are never filled here.
export async function executePlannerCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { candidate: { type: "string" }, bundle: { type: "string" },
    config: { type: "string" }, "dry-run": { type: "boolean" }, fresh: { type: "boolean" }, "max-cost-usd": { type: "string" } } });
  if (positionals.length !== 1 || positionals[0] !== "run" || !values.candidate || !/^[a-f0-9]{64}$/.test(values.bundle ?? "")) throw new PrivateError("planner_command_invalid");
  const capNanoUsd = Number(values["max-cost-usd"]) * 1e9;
  if (!values["dry-run"] && (!Number.isSafeInteger(capNanoUsd) || capNanoUsd <= 0)) throw new PrivateError("explicit_cap_required");
  return executePlannerProduction({ operation: "run", candidate: values.candidate, bundleId: values.bundle, configPath: values.config,
    dryRun: values["dry-run"], fresh: values.fresh, stageOnly: false, capNanoUsd });
}

export async function executePlannerProduction(options: { operation: string; runId?: string; candidate?: string; bundleId?: string; configPath?: string;
  dryRun?: boolean; fresh?: boolean; stageOnly?: boolean; capNanoUsd?: number }) {
  const local = await openLocalProductionStores();
  try {
    const currentIntake = () => loadPipelineConfig(options.configPath ?? fileURLToPath(new URL("../config/pipeline.yaml", import.meta.url)));
    const ledger = await createReceiptLedger({ directory: productionLedgerDirectory, checkout: fileURLToPath(new URL("../", import.meta.url)) });
    const gates = createProductionCoordinator({ ...local, ledger, currentIntake, execution: { kind: "live", model: createSystemOneAdapter({ apiKey: "authorization-only" }) } });
    const planner = createPlannerCoordinator({ ...local, ledger, currentIntake, executionKind: "live", model: createLunaAdapter({ apiKey: process.env.OPENROUTER_API_KEY }),
      authorizeGates: (bundleId, intake) => gates.authorizeDownstream({ bundleId, intake }),
      beforeDispatch: async () => {
        if (!process.env.OPENROUTER_API_KEY || options.operation === "inspect" || options.operation === "recover") throw new PrivateError("dispatch_forbidden");
        await verifyLunaSetup();
      } });
    if (options.operation === "inspect") return await planner.inspect(options.runId!);
    if (options.operation === "recover") return await planner.recover(options.runId!);
    if (options.operation === "resume") return await planner.run(options.runId!);
    if (options.dryRun) return await planner.dryRun(options.bundleId!, options.candidate!, PLANNER_CONFIGURATION);
    const id = await planner.create({ bundleId: options.bundleId!, candidate: options.candidate!, configuration: PLANNER_CONFIGURATION, fresh: options.fresh, stageOnly: options.stageOnly, capNanoUsd: options.capNanoUsd! });
    try { return await planner.run(id); }
    catch (error) { throw new PrivateError(error instanceof PrivateError ? error.code : "planner_run_failed", { runId: id }); }
  } finally { await local.close(); }
}
