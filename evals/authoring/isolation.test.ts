// @vitest-environment node
import { build } from "esbuild";
import { expect, it } from "vitest";

it("keeps the complete authoring import graph free of model, database and telemetry clients", async () => {
  // Bundle in memory only. This checks transitive dependencies, not just one import list.
  const result = await build({ entryPoints: ["evals/private-authoring.ts"], platform: "node", format: "esm",
    bundle: true, write: false, metafile: true, logLevel: "silent" });
  const inputs = Object.keys(result.metafile!.inputs);
  expect(inputs.some(path => /pipeline\/(execution|stages)\/|braintrust|openrouter|node_modules\/(pg|@opentelemetry)\//.test(path))).toBe(false);
  expect(inputs.some(path => path.includes("age-encryption"))).toBe(true);
});
