import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { fingerprint } from "./config.js";
import { createAppropriatenessStage, type AppropriatenessConfiguration, type AppropriatenessInput } from "./stages/appropriateness.js";
import { createUsefulnessStage, type Subject, type UsefulnessConfiguration } from "./stages/usefulness.js";

export async function productionImplementation() {
  const files = ["run.ts", "reuse.ts", "production-config.ts", "execution/executor.ts", "execution/model.ts", "execution/stage.ts",
    "execution/system-one.ts", "storage/postgres.ts", "storage/receipts.ts", "storage/crypto.ts", "stages/appropriateness.ts",
    "stages/usefulness.ts", "stages/usefulness-questions.json", "execution/jev.ts", "usefulness-promotion.ts", "../package-lock.json"];
  return fingerprint(await Promise.all(files.map(async path => ({ path, bytes: await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8") }))));
}

export async function usefulnessReuseIdentity(input: Subject, configuration: UsefulnessConfiguration, bundleId: string) {
  const stage = createUsefulnessStage(configuration);
  const files = ["stages/usefulness.ts", "execution/jev.ts", "execution/stage.ts", "execution/model.ts", "execution/system-one.ts"];
  const lock = JSON.parse(await readFile(fileURLToPath(new URL("../package-lock.json", import.meta.url)), "utf8"));
  // A new source bundle is not verified correspondence across releases, even
  // when its strings happen to match. Intake changes remain authorization only.
  return fingerprint({ input, bundleId, request: stage.render(input), configuration: stage.configuration, contractDependency: lock.packages["node_modules/zod"],
    implementation: await Promise.all(files.map(async path => ({ path, bytes: await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8") }))) });
}

export async function appropriatenessReuseIdentity(input: AppropriatenessInput, configuration: AppropriatenessConfiguration) {
  const stage = createAppropriatenessStage(configuration);
  const files = ["stages/appropriateness.ts", "execution/stage.ts", "execution/model.ts", "execution/system-one.ts"];
  const lock = JSON.parse(await readFile(fileURLToPath(new URL("../package-lock.json", import.meta.url)), "utf8"));
  // Only the exact headword is source-derived model input. Source readiness,
  // intake and promotion are checked separately on each authorization.
  return fingerprint({ input, request: stage.render(input), configuration: stage.configuration, contractDependency: lock.packages["node_modules/zod"],
    implementation: await Promise.all(files.map(async path => ({ path, bytes: await readFile(fileURLToPath(new URL(path, import.meta.url)), "utf8") }))) });
}
