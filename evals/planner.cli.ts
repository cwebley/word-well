import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { openLocalPrivateStore, checkout } from "./private-local.js";
import { loadPlannerDataset } from "./datasets/planner.js";
import { createPlannerEvaluator } from "./planner.js";
import { createLunaAdapter } from "../pipeline/execution/openrouter.js";
import { createReceiptLedger } from "../pipeline/storage/receipts.js";
import { PLANNER_CONFIGURATION, createPlannerStage } from "../pipeline/stages/planner.js";
import { LUNA_EXECUTION, lunaExecutionSettings } from "../pipeline/planner-config.js";
import { recordPlannerDecision, recordPlannerReview } from "../pipeline/planner-promotion.js";
import { PrivateError } from "../pipeline/storage/crypto.js";
import { verifyLunaSetup } from "../pipeline/execution/luna-setup.js";

export async function plannerCommand(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { dataset: { type: "string" }, "max-cost-usd": { type: "string" }, "owner-review": { type: "string" }, "owner-decision": { type: "string" } } });
  const [operation, id] = positionals;
  const allowed = operation === "run" ? ["dataset", "max-cost-usd"] : operation === "dry-run" ? ["dataset"] : operation === "review" ? ["owner-review"] : operation === "decision" ? ["owner-decision"] : [];
  if (!["run", "dry-run", "resume", "recover", "inspect", "review", "decision"].includes(operation) || Object.keys(values).some(k => !allowed.includes(k)) ||
    ["run", "dry-run", "review", "decision"].includes(operation) && positionals.length !== 1 || ["resume", "recover", "inspect"].includes(operation) && positionals.length !== 2) throw new PrivateError("planner_command_invalid");
  const local = await openLocalPrivateStore();
  try {
    const ledger = await createReceiptLedger({ directory: resolve(homedir(), "Library/Application Support/WordWell/planner-evaluation/ledger"), checkout });
    const evaluator = createPlannerEvaluator({ store: local.store, ledger, model: createLunaAdapter({ apiKey: process.env.OPENROUTER_API_KEY }),
      beforeDispatch: async () => {
        if (!["run", "resume"].includes(operation) || !process.env.OPENROUTER_API_KEY) throw new PrivateError("dispatch_forbidden");
        await verifyLunaSetup();
      } });
    if (operation === "inspect") return await evaluator.inspect(id);
    if (operation === "recover") return await evaluator.recover(id);
    if (operation === "resume") return await evaluator.run(id);
    if (operation === "review") return await recordPlannerReview(local.store, evaluator, JSON.parse(await readFile(values["owner-review"]!, "utf8")));
    if (operation === "decision") return await recordPlannerDecision(local.store, evaluator, JSON.parse(await readFile(values["owner-decision"]!, "utf8")));
    if (!values.dataset) throw new PrivateError("frozen_dataset_required");
    const frozen = await loadPlannerDataset(values.dataset, local.crypto);
    if (operation === "dry-run") return { dataset: frozen.manifest, contentIdentity: frozen.dataset.contentIdentity, cases: frozen.dataset.cases.map(c => ({ caseId: c.id,
      request: createPlannerStage(PLANNER_CONFIGURATION, c.input).render(c.input) })), intentionalTrials: frozen.dataset.cases.length * 3, execution: LUNA_EXECUTION,
      reservationNanoUsd: lunaExecutionSettings(LUNA_EXECUTION, PLANNER_CONFIGURATION.maxOutputTokens).reservationNanoUsd, modelCalls: 0 };
    const capNanoUsd = Number(values["max-cost-usd"]) * 1e9;
    if (!Number.isSafeInteger(capNanoUsd) || capNanoUsd <= 0) throw new PrivateError("explicit_cap_required");
    const experimentId = await evaluator.create({ ...frozen, configuration: PLANNER_CONFIGURATION, capNanoUsd });
    try { return await evaluator.run(experimentId); }
    catch (error) { throw new PrivateError(error instanceof PrivateError ? error.code : "planner_evaluation_failed"); }
  } finally { await local.store.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await plannerCommand(process.argv.slice(2)))); }
  catch (error) { console.error(error instanceof PrivateError ? error.code : "planner_command_failed"); process.exitCode = 1; }
}
