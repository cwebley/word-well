import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkout, openLocalPrivateStore } from "../evals/private-local.js";
import { manifestSchema } from "../evals/authoring/store.js";
import { loadPipelineConfig } from "./config.js";
import { revalidateSavedGatePromotion } from "./gate-promotion-compatibility.js";
import { createProductionCoordinator } from "./run.js";
import { APPROPRIATENESS_CONFIGURATION, createAppropriatenessStage } from "./stages/appropriateness.js";
import { openLocalProductionStores, productionLedgerDirectory } from "./storage/production-local.js";
import { createReceiptLedger } from "./storage/receipts.js";
import { createValidationOnlySystemOneAdapter } from "./execution/validation-only.js";
import { PrivateError } from "./storage/crypto.js";
import { authorizeScopedCandidate } from "./sources/index.js";

// No provider credential, generation dispatch or metadata lookup is available.
// Schema migration is a separate operation, as for other pipeline commands.
export async function executeGateCompatibilityCommand(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    dataset: { type: "string" }, candidate: { type: "string" }, bundle: { type: "string" }, config: { type: "string" }, stage: { type: "string" }
  } });
  const [group, operation] = positionals;
  if (positionals.length !== 2 || group !== "compatibility") throw new PrivateError("compatibility_command_invalid");
  if (operation === "revalidate-promotion") {
    if (!/^appropriateness-v[0-9]{6}$/.test(values.dataset ?? "") || values.candidate || values.bundle || values.config || values.stage) throw new PrivateError("compatibility_command_invalid");
    const local = await openLocalPrivateStore();
    try {
      const datasetDir = resolve(checkout, "evals/datasets", values.dataset!);
      const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(datasetDir, "manifest.json"), "utf8")));
      return await revalidateSavedGatePromotion({ ...local, datasetDir, manifest,
        configurationFingerprint: createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION).fingerprint });
    } finally { await local.store.close(); }
  }
  if (operation !== "revalidate-gates" || values.dataset || !values.candidate || !/^[a-f0-9]{64}$/.test(values.bundle ?? "") || values.stage && !["appropriateness", "usefulness"].includes(values.stage)) throw new PrivateError("compatibility_command_invalid");
  const local = await openLocalProductionStores();
  try {
    const currentIntake = () => loadPipelineConfig(values.config ?? resolve(checkout, "config/pipeline.yaml"));
    const intake = await currentIntake();
    const candidate = await authorizeScopedCandidate(local.sources, values.bundle!, intake);
    if (candidate.headword !== values.candidate) throw new PrivateError("candidate_outside_bundle_scope");
    const ledger = await createReceiptLedger({ directory: productionLedgerDirectory, checkout });
    const coordinator = createProductionCoordinator({ ...local, ledger, currentIntake, execution: { kind: "live",
      model: createValidationOnlySystemOneAdapter() } });
    return await coordinator.revalidateSavedGates({ bundleId: values.bundle!, intake, stage: values.stage as "appropriateness" | "usefulness" | undefined });
  } finally { await local.close(); }
}
