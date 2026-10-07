import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { checkout, openLocalPrivateStore } from "../evals/private-local.js";
import { manifestSchema } from "../evals/authoring/store.js";
import { assessSavedPromotion, recordOwnerPromotion } from "./promotion.js";
import { PrivateError } from "./storage/crypto.js";
import { recordApprovedUsefulnessPromotion } from "./usefulness-promotion.js";
import { openLocalProductionStores } from "./storage/production-local.js";

// This entry point has no adapter, executor or provider credential.
export async function executePromotionCommand(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: { dataset: { type: "string" }, "owner-decision": { type: "string" } } });
  const [group, operation, experimentId] = positionals;
  if (group !== "promotion") throw new PrivateError("promotion_command_invalid");
  if (operation === "record-usefulness") {
    if (positionals.length !== 2 || Object.keys(values).length) throw new PrivateError("promotion_command_invalid");
    const local = await openLocalProductionStores();
    try { return await recordApprovedUsefulnessPromotion(local.store); }
    finally { await local.close(); }
  }
  if (operation === "assess") {
    if (positionals.length !== 3 || !z.uuid().safeParse(experimentId).success || !/^appropriateness-v[0-9]{6}$/.test(values.dataset ?? "") || values["owner-decision"]) throw new PrivateError("promotion_command_invalid");
  } else if (operation !== "record" || positionals.length !== 2 || !values["owner-decision"] || values.dataset) throw new PrivateError("promotion_command_invalid");
  const local = await openLocalPrivateStore();
  try {
    if (operation === "record") return await recordOwnerPromotion(local.store, JSON.parse(await readFile(values["owner-decision"]!, "utf8")));
    const datasetDir = resolve(checkout, "evals/datasets", values.dataset!);
    const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(datasetDir, "manifest.json"), "utf8")));
    return await assessSavedPromotion({ ...local, datasetDir, manifest, experimentId });
  } finally { await local.store.close(); }
}
