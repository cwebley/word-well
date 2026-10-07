// @vitest-environment node
import { expect, it } from "vitest";
import { verifyLunaSetup } from "./luna-setup.js";
const endpoint = { name: "OpenAI | openai/gpt-5.6-luna-20260709", tag: "openai", status: 0, max_prompt_tokens: 922000, max_completion_tokens: 128000,
  supported_parameters: ["max_tokens", "response_format", "structured_outputs"], pricing: { prompt: "0.0000002", completion: "0.0000012", overrides: [{ prompt: "0.0000004", completion: "0.0000018" }] } };
it("verifies the exact default endpoint, supported contract and highest price tier without generation", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async url => { calls++; expect(String(url)).toContain("/endpoints"); return new Response(JSON.stringify({ data: { endpoints: [endpoint] } })); };
  expect(await verifyLunaSetup(fetch)).toMatchObject({ endpoint, modelCalls: 0 });
  expect(calls).toBe(1);
});
it.each([
  { ...endpoint, name: "OpenAI | different-model" }, { ...endpoint, tag: "azure" }, { ...endpoint, max_prompt_tokens: 1000000 },
  { ...endpoint, supported_parameters: ["max_tokens"] }, { ...endpoint, pricing: { prompt: "0.0000009", completion: "0.0000018" } }
])("rejects changed upstream, routing, token bounds, contract or pricing", async changed => {
  await expect(verifyLunaSetup(async () => new Response(JSON.stringify({ data: { endpoints: [changed] } })))).rejects.toThrow("luna_endpoint_changed");
});
