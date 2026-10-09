import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fingerprint } from "./config.js";
import { digest, PrivateError } from "./storage/crypto.js";
import { GATE_COMPATIBILITY_POLICY } from "./gate-compatibility.js";
import { createAppropriatenessStage, type AppropriatenessConfiguration, type AppropriatenessInput } from "./stages/appropriateness.js";
import { createUsefulnessStage, type Subject, type UsefulnessConfiguration } from "./stages/usefulness.js";

export async function productionImplementation() {
  const files = ["run.ts", "reuse.ts", "production-config.ts", "execution/executor.ts", "execution/model.ts", "execution/stage.ts",
    "execution/system-one.ts", "storage/postgres.ts", "storage/receipts.ts", "storage/crypto.ts", "stages/appropriateness.ts",
    "stages/usefulness.ts", "stages/usefulness-questions.json", "execution/jev.ts", "execution/validation-only.ts", "usefulness-promotion.ts", "gate-compatibility.ts", "gate-promotion-compatibility.ts", "../package-lock.json"];
  return fingerprint(await Promise.all(files.map(async path => ({ path, bytes: await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8") }))));
}

async function implementation(stage: "appropriateness" | "usefulness", historicalModel?: string) {
  // Both stages import model.ts only for erased types. Their executable adapter,
  // validation and policy remain hashed. Luna types cannot change these gates.
  const files = stage === "appropriateness" ? ["stages/appropriateness.ts", "execution/stage.ts", "execution/system-one.ts"]
    : ["stages/usefulness.ts", "execution/jev.ts", "execution/stage.ts", "execution/system-one.ts"];
  if (historicalModel !== undefined) files.splice(files.length - 1, 0, "execution/model.ts");
  else files.push("execution/executor.ts");
  return Promise.all(files.map(async path => ({ path, bytes: path === "execution/model.ts" ? historicalModel! : await readFile(new URL(path, import.meta.url), "utf8") })));
}
export async function assertHistoricalGateExecution(implementationIdentity?: string) {
  // These are the inspected executable bytes at #34's approved checkpoint.
  // The old result identity omitted the executor, so the original whole-run
  // identity must also belong to the inspected production lineage.
  const expected = { "execution/executor.ts": "257e915e90c7a7cdddcabd18b1393121357d13ab6403a58a7f37f4fe548b912b",
    "execution/system-one.ts": "0e27ea570beff045c2ce42d9c7ed204e2c17c787bff03c3996e52aea85303399" };
  for (const [path, identity] of Object.entries(expected)) {
    if (digest(await readFile(new URL(path, import.meta.url), "utf8")) !== identity) throw new PrivateError("gate_execution_changed");
  }
  if (implementationIdentity && !(GATE_COMPATIBILITY_POLICY.historicalProductionImplementations as readonly string[]).includes(implementationIdentity)) throw new PrivateError("gate_execution_changed");
}
async function historicalModels() {
  const original = await readFile(new URL("./compatibility/model-before-luna.txt", import.meta.url), "utf8");
  if (digest(original) !== "b2b73c1bd8ec67f416ac3bd517274a5b6b7576bb6f1487c970ab06bd0eb8e1f4") throw new PrivateError("gate_compatibility_invalid");
  const pending = original.replace('  | { kind: "retryable" }\n', '  | { kind: "retryable" }\n  | { kind: "verification_pending"; nextEligibleAt?: string }\n')
    .replace("  accounting(exchange: Exchange): Accounting;", "  // Reads evidence about an existing generation. Never creates another answer.\n  verify?(exchange: Exchange): Promise<Exchange>;\n  accounting(exchange: Exchange): Accounting;");
  const unresolved = pending.replace('  | { kind: "verification_pending"; nextEligibleAt?: string }\n', '  | { kind: "verification_pending"; nextEligibleAt?: string }\n  | { kind: "verification_unresolved"; code: string }\n');
  return [original, pending, unresolved];
}
async function usefulnessIdentity(input: Subject, configuration: UsefulnessConfiguration, bundleId: string, historicalModel?: string) {
  const stage = createUsefulnessStage(configuration);
  const lock = JSON.parse(await readFile(fileURLToPath(new URL("../package-lock.json", import.meta.url)), "utf8"));
  // A new source bundle is not verified correspondence across releases, even
  // when its strings happen to match. Intake changes remain authorization only.
  return fingerprint({ input, bundleId, request: stage.render(input), configuration: stage.configuration, contractDependency: lock.packages["node_modules/zod"],
    implementation: await implementation("usefulness", historicalModel) });
}

async function appropriatenessIdentity(input: AppropriatenessInput, configuration: AppropriatenessConfiguration, historicalModel?: string) {
  const stage = createAppropriatenessStage(configuration);
  const lock = JSON.parse(await readFile(fileURLToPath(new URL("../package-lock.json", import.meta.url)), "utf8"));
  // Only the exact headword is source-derived model input. Source readiness,
  // intake and promotion are checked separately on each authorization.
  return fingerprint({ input, request: stage.render(input), configuration: stage.configuration, contractDependency: lock.packages["node_modules/zod"],
    implementation: await implementation("appropriateness", historicalModel) });
}
export const appropriatenessReuseIdentity = (input: AppropriatenessInput, configuration: AppropriatenessConfiguration) => appropriatenessIdentity(input, configuration);
export const usefulnessReuseIdentity = (input: Subject, configuration: UsefulnessConfiguration, bundleId: string) => usefulnessIdentity(input, configuration, bundleId);
export async function historicalAppropriatenessIdentities(input: AppropriatenessInput, configuration: AppropriatenessConfiguration) {
  await assertHistoricalGateExecution();
  return Promise.all((await historicalModels()).map(model => appropriatenessIdentity(input, configuration, model)));
}
export async function historicalUsefulnessIdentities(input: Subject, configuration: UsefulnessConfiguration, bundleId: string) {
  await assertHistoricalGateExecution();
  return Promise.all((await historicalModels()).map(model => usefulnessIdentity(input, configuration, bundleId, model)));
}
