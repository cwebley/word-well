import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadPipelineConfig } from "./config.js";
import { PrivateError } from "./storage/crypto.js";
import type { SourceStore } from "./storage/sources.js";
import { buildScopedCandidate, explainScopedCandidate, importScopedBundle } from "./sources/index.js";

const local = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
// Both CLI and integration checks call this operator entry point. Tests supply
// restricted storage and harmless in-memory keys, never a second importer.
export async function executeSourceCommand(args: string[], openStore: () => Promise<SourceStore>) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    directory: { type: "string" }, scope: { type: "string" }, manifest: { type: "string" }, bundle: { type: "string" }, config: { type: "string" }, limit: { type: "string" }
  } });
  const [group, operation, headword] = positionals;
  const allowed = group === "sources" && operation === "import" ? ["directory", "scope", "manifest", "limit", "config"]
    : group === "config" && operation === "show" ? ["config"] : ["bundle", "config"];
  if (Object.keys(values).some(key => !allowed.includes(key))) throw new PrivateError("source_command_option_invalid");
  const config = await loadPipelineConfig(values.config ?? local("config/pipeline.yaml"));
   if (group === "config" && operation === "show" && positionals.length === 2) {
     const { productionConfiguration } = await import("./production-commands.js");
     return { effectiveConfiguration: config, appropriateness: await productionConfiguration(), modelCalls: 0 };
   }
  if (!((group === "sources" && operation === "import" && positionals.length === 2) || (group === "candidates" && operation === "build" && positionals.length === 2) || (group === "candidate" && operation === "explain" && positionals.length === 3))) throw new PrivateError("source_command_invalid");
  if (group !== "sources" && !/^[0-9a-f]{64}$/.test(values.bundle ?? "")) throw new PrivateError("explicit_bundle_required");
  const limit = values.limit === undefined ? undefined : Number(values.limit);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || group !== "sources")) throw new PrivateError("import_limit_invalid");
  const store = await openStore();
  try {
    if (group === "sources") return await importScopedBundle(store, { scope: values.scope ?? local("config/emulate-scope.json"), manifest: values.manifest ?? local("config/sources.lock.json"), directory: values.directory, limit });
    if (group === "candidates") return { ...await buildScopedCandidate(store, values.bundle!, config), modelCalls: 0 };
    return await explainScopedCandidate(store, values.bundle!, headword!, config);
  } finally { await store.close(); }
}
