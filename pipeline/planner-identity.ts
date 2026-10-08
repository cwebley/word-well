import { readFile } from "node:fs/promises";
import { fingerprint } from "./config.js";
import { createPlannerStage, type PlannerConfiguration, type PlannerInput } from "./stages/planner.js";
export async function plannerImplementation() {
  const paths = ["./stages/planner.ts", "./sources/planner.ts", "./planner-config.ts", "./planner-run.ts", "./planner-identity.ts", "./planner-promotion.ts",
    "./execution/openrouter.ts", "./execution/luna-response.ts", "./execution/luna-setup.ts", "./execution/executor.ts", "./execution/model.ts", "./execution/stage.ts", "./storage/postgres.ts", "./storage/receipts.ts", "./storage/crypto.ts", "../evals/planner.ts", "../evals/datasets/planner.ts", "../db/private-migrations/011_request_verifications.sql", "../db/private-migrations/013_verification_unresolved.sql", "../package-lock.json"];
  return fingerprint(await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))));
}
export async function plannerReuseIdentity(input: PlannerInput, config: PlannerConfiguration) {
  const stage = createPlannerStage(config, input);
  const paths = ["./stages/planner.ts", "./sources/planner.ts", "./planner-config.ts", "./execution/openrouter.ts", "./execution/luna-response.ts"];
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  return fingerprint({ input, request: stage.render(input), config, dependencies: ["zod", "ai", "@openrouter/ai-sdk-provider"].map(name => lock.packages[`node_modules/${name}`]),
    implementation: await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))) });
}
