// The spend guard. The pilot budget is $10 and no run starts when its estimate
// would exceed what is left, so the failure mode is a refused run rather than a
// surprise on the invoice.
//
// Spend is read back from the persisted run records, so it counts what was
// actually charged rather than what was predicted, and a reused record costs
// nothing because no call is made.

import { readdirSync, readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Claim } from "./claim.ts";
import type { ModelConfig } from "./fingerprint.ts";
import { buildMessages } from "./prompt.ts";
import type { AdjudicationRecord } from "./store.ts";

/** Rough characters-per-token. Deliberately pessimistic. */
const CHARS_PER_TOKEN = 3.5;
/** Headroom for the output, including reasoning tokens we cannot see in advance. */
const ASSUMED_OUTPUT_TOKENS = 1600;
/** Safety factor on the whole estimate, so an underestimate does not breach the cap. */
const ESTIMATE_MARGIN = 2;

export interface ModelPrice {
  /** USD per prompt token, as OpenRouter reports it. */
  prompt: number;
  completion: number;
}

export function spentSoFar(runsDir: string): number {
  if (!existsSync(runsDir)) return 0;
  let total = 0;
  for (const file of readdirSync(runsDir)) {
    if (!file.endsWith(".json")) continue;
    const record = JSON.parse(readFileSync(join(runsDir, file), "utf-8")) as AdjudicationRecord;
    total += record.usage.cost_usd ?? 0;
  }
  return total;
}

export async function fetchPrice(model: string, apiKey: string): Promise<ModelPrice> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`could not read model prices: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as {
    data: { id: string; pricing: { prompt: string; completion: string } }[];
  };
  const entry = body.data.find((m) => m.id === model);
  if (!entry) throw new Error(`OpenRouter does not list a model called ${model}`);
  return { prompt: Number(entry.pricing.prompt), completion: Number(entry.pricing.completion) };
}

export function estimateCost(claims: Claim[], price: ModelPrice): number {
  let total = 0;
  for (const claim of claims) {
    const chars = buildMessages(claim).reduce((sum, m) => sum + m.content.length, 0);
    const promptTokens = chars / CHARS_PER_TOKEN;
    total += promptTokens * price.prompt + ASSUMED_OUTPUT_TOKENS * price.completion;
  }
  return total * ESTIMATE_MARGIN;
}

export interface BudgetCheck {
  spent: number;
  estimate: number;
  remaining: number;
  allowed: boolean;
}

export function checkBudget(spent: number, estimate: number, cap: number): BudgetCheck {
  const remaining = cap - spent;
  return { spent, estimate, remaining, allowed: estimate <= remaining };
}

export function describeBudget(check: BudgetCheck, model: ModelConfig, cap: number): string {
  return [
    `model:     ${model.model} via ${model.upstreamProvider}`,
    `pilot cap: $${cap.toFixed(2)}`,
    `spent:     $${check.spent.toFixed(4)}`,
    `estimate:  $${check.estimate.toFixed(4)} (pessimistic, ${ESTIMATE_MARGIN}x margin)`,
    `remaining: $${check.remaining.toFixed(4)}`,
  ].join("\n");
}
