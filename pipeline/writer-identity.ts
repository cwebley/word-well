import { readFile } from "node:fs/promises";
import { fingerprint } from "./config.js";
import { createWriterStage, type WriterConfiguration, type WriterInput } from "./stages/writer.js";

export async function writerImplementation() {
  const paths = ["./stages/writer.ts", "./sources/writer.ts", "./writer-run.ts", "./writer-identity.ts", "./writer-promotion.ts", "./storage/writer.ts",
    "./planner-config.ts", "./execution/openrouter.ts", "./execution/luna-response.ts", "./execution/luna-setup.ts", "./execution/executor.ts", "./execution/model.ts", "./execution/stage.ts",
    "./storage/postgres.ts", "./storage/receipts.ts", "./storage/crypto.ts", "../evals/writer.ts", "../evals/datasets/writer.ts", "../db/private-migrations/012_lesson_writer.sql", "../db/private-migrations/013_verification_unresolved.sql", "../package-lock.json"];
  return fingerprint(await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))));
}
export async function writerReuseIdentity(input: WriterInput, configuration: WriterConfiguration) {
  const stage = createWriterStage(configuration, input);
  const paths = ["./stages/writer.ts", "./sources/writer.ts", "./planner-config.ts", "./execution/openrouter.ts", "./execution/luna-response.ts"];
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  return fingerprint({ input, request: stage.render(input), configuration, dependencies: ["zod", "ai", "@openrouter/ai-sdk-provider"].map(name => lock.packages[`node_modules/${name}`]),
    implementation: await Promise.all(paths.map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") }))) });
}
