// Lists OpenRouter models that can hold the output contract, cheapest first, and
// — given a model id — the upstreams that serve it.
//
// The plan requires current model identifiers to be chosen immediately before a
// benchmark and the prices used to be recorded, so this reads the live catalogue
// rather than trusting a name written down weeks earlier. Since stage 1, it also
// has to answer "which upstream do I pin?", because pinning one is mandatory.
//
//   npm run models                                   # cheapest 25
//   npm run models -- 40                             # cheapest 40
//   npm run models -- deepseek/deepseek-v4-flash-0731  # its upstreams

import { OPENROUTER_BASE_URL, requireEnv } from "./config.ts";

interface CatalogueModel {
  id: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
}

interface Endpoint {
  tag: string;
  name: string;
  provider_name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  quantization?: string | null;
  supported_parameters?: string[];
  status?: number | null;
}

const perMillion = (v: string) => `$${(Number(v) * 1e6).toFixed(3)}`;

async function get<T>(path: string, apiKey: string): Promise<T> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

async function listEndpoints(model: string, apiKey: string) {
  const { data } = await get<{ data: { endpoints: Endpoint[] } }>(
    `models/${model}/endpoints`,
    apiKey,
  );
  const usable = data.endpoints.filter((e) =>
    e.supported_parameters?.includes("structured_outputs"),
  );

  console.log(`${data.endpoints.length} upstreams serve ${model}, ` +
    `${usable.length} of them with structured output.\n`);
  console.log("Pin one of these as OPENROUTER_PROVIDER:\n");
  for (const e of usable) {
    console.log(
      `  ${e.tag.padEnd(36)} ${e.provider_name.padEnd(20)} ${(e.quantization ?? "unknown").padEnd(8)} ` +
        `${perMillion(e.pricing.prompt).padStart(9)}/M in  ${perMillion(e.pricing.completion).padStart(10)}/M out  ${e.context_length} ctx`,
    );
  }
  const skipped = data.endpoints.filter((e) => !usable.includes(e));
  if (skipped.length) {
    console.log(`\nNot eligible, no structured output: ${skipped.map((e) => e.provider_name).join(", ")}`);
  }
}

async function listModels(limit: number, apiKey: string) {
  const { data } = await get<{ data: CatalogueModel[] }>("models", apiKey);
  const structured = data
    .filter((m) => m.supported_parameters?.includes("structured_outputs"))
    .filter((m) => Number(m.pricing.prompt) > 0)
    .sort((a, b) => Number(a.pricing.completion) - Number(b.pricing.completion));

  console.log(`${structured.length} models advertise structured outputs; cheapest ${limit}:\n`);
  for (const m of structured.slice(0, limit)) {
    console.log(
      `${m.id.padEnd(46)} ${perMillion(m.pricing.prompt).padStart(9)}/M in  ` +
        `${perMillion(m.pricing.completion).padStart(10)}/M out  ${m.context_length} ctx`,
    );
  }
  console.log("\nThen: npm run models -- <model-id>   to choose an upstream to pin.");
}

async function main() {
  const apiKey = requireEnv("OPENROUTER_API_KEY");
  const arg = process.argv[2];
  if (arg && arg.includes("/")) await listEndpoints(arg, apiKey);
  else await listModels(Number(arg ?? 25), apiKey);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
