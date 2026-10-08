import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { checkout } from "./private-local.js";
import { openLocalWriterStores } from "../pipeline/storage/writer-local.js";
import { freezeWriterDataset, loadWriterDataset } from "./datasets/writer.js";
import { createWriterEvaluator } from "./writer.js";
import { createLunaAdapter } from "../pipeline/execution/openrouter.js";
import { createReceiptLedger } from "../pipeline/storage/receipts.js";
import { WRITER_CONFIGURATION, createWriterStage } from "../pipeline/stages/writer.js";
import { LUNA_EXECUTION, lunaExecutionSettings } from "../pipeline/planner-config.js";
import { recordWriterDecision, recordWriterReview } from "../pipeline/writer-promotion.js";
import { PrivateError } from "../pipeline/storage/crypto.js";
import { verifyLunaSetup } from "../pipeline/execution/luna-setup.js";

export async function writerCommand(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { dataset: { type: "string" }, "max-cost-usd": { type: "string" },
    "owner-review": { type: "string" }, "owner-decision": { type: "string" }, "owner-cases": { type: "string" }, directory: { type: "string" }, version: { type: "string" } } });
  const [operation, id] = positionals;
  const allowed = operation === "run" ? ["dataset", "max-cost-usd"] : operation === "dry-run" ? ["dataset"] : operation === "review" ? ["owner-review"] : operation === "decision" ? ["owner-decision"] : operation === "freeze" ? ["owner-cases", "directory", "version"] : [];
  if (!["freeze", "run", "dry-run", "resume", "recover", "inspect", "review", "decision"].includes(operation) || Object.keys(values).some(k => !allowed.includes(k)) ||
    ["freeze", "run", "dry-run", "review", "decision"].includes(operation) && positionals.length !== 1 || ["resume", "recover", "inspect"].includes(operation) && positionals.length !== 2 ||
    operation === "freeze" && (!values["owner-cases"] || !values.directory || !values.version) ||
    operation === "review" && !values["owner-review"] || operation === "decision" && !values["owner-decision"]) throw new PrivateError("writer_command_invalid");
  const local = await openLocalWriterStores(true);
  try {
    if (operation === "freeze") return await freezeWriterDataset({ directory: values.directory!, checkout, version: Number(values.version),
      cases: JSON.parse(await readFile(values["owner-cases"]!, "utf8")), key: local.keys.datasetKey, crypto: local.crypto });
    const ledger = await createReceiptLedger({ directory: resolve(homedir(), "Library/Application Support/WordWell/writer-evaluation/ledger"), checkout });
    const evaluator = createWriterEvaluator({ store: local.store, ledger, model: createLunaAdapter({ apiKey: process.env.OPENROUTER_API_KEY }),
      beforeDispatch: async () => {
        if (!["run", "resume"].includes(operation) || !process.env.OPENROUTER_API_KEY) throw new PrivateError("dispatch_forbidden");
        await verifyLunaSetup();
      } });
    if (operation === "inspect") return await evaluator.inspect(id);
    if (operation === "recover") return await evaluator.recover(id);
    if (operation === "resume") return await evaluator.run(id);
    if (operation === "review") return await recordWriterReview(local.store, evaluator, JSON.parse(await readFile(values["owner-review"]!, "utf8")));
    if (operation === "decision") return await recordWriterDecision(local.store, evaluator, JSON.parse(await readFile(values["owner-decision"]!, "utf8")));
    if (!values.dataset) throw new PrivateError("frozen_dataset_required");
    const frozen = await loadWriterDataset(values.dataset, local.crypto);
    if (operation === "dry-run") return { dataset: frozen.manifest, contentIdentity: frozen.dataset.contentIdentity, cases: frozen.dataset.cases.map(c => ({ caseId: c.id,
      request: createWriterStage(WRITER_CONFIGURATION, c.input).render(c.input) })), intentionalTrials: frozen.dataset.cases.length * 3, execution: LUNA_EXECUTION,
      reservationNanoUsd: lunaExecutionSettings(LUNA_EXECUTION, WRITER_CONFIGURATION.maxOutputTokens).reservationNanoUsd, modelCalls: 0 };
    const capNanoUsd = Number(values["max-cost-usd"]) * 1e9;
    if (!Number.isSafeInteger(capNanoUsd) || capNanoUsd <= 0) throw new PrivateError("explicit_cap_required");
    const experimentId = await evaluator.create({ ...frozen, configuration: WRITER_CONFIGURATION, capNanoUsd });
    return await evaluator.run(experimentId);
  } finally { await local.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await writerCommand(process.argv.slice(2)))); }
  catch (error) { console.error(error instanceof PrivateError ? error.code : "writer_command_failed"); process.exitCode = 1; }
}
