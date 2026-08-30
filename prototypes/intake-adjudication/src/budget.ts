// The spend guard. The pilot budget is $10 for all of #46 — every gate, not one
// each — and no run starts when its estimate would exceed what is left, so the
// failure mode is a refused run rather than a surprise on the invoice.
//
// Spend is read back from the persisted run records, so it counts what was
// actually charged rather than what was predicted, and a reused record costs
// nothing because no call is made.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { OPENROUTER_BASE_URL, PILOT_BUDGET_USD, RUNS_DIR } from "./config.ts";
import type { ModelConfig } from "./fingerprint.ts";
import type { Gate } from "./gate.ts";

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

export const LEDGER = "spend-ledger.jsonl";

/**
 * Every paid call, whether or not its record was persisted.
 *
 * Summing the run records was wrong: a `--fresh` reliability probe deliberately
 * stores no record, so its spend was invisible to the cap. Money spent is money
 * spent, and the guard has to see all of it.
 */
export function recordSpend(runsDir: string, entry: SpendEntry): void {
  mkdirSync(runsDir, { recursive: true });
  appendFileSync(join(runsDir, LEDGER), `${JSON.stringify(entry)}\n`);
}

export interface SpendEntry {
  at: string;
  claim_id: string;
  fingerprint_key: string;
  cost_usd: number;
  persisted: boolean;
}

export function spentSoFar(runsDir: string): number {
  const ledger = join(runsDir, LEDGER);
  if (!existsSync(ledger)) return 0;
  return readFileSync(ledger, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .reduce((total, line) => total + ((JSON.parse(line) as SpendEntry).cost_usd ?? 0), 0);
}

/**
 * The price of the upstream we actually pinned, not the model's headline price.
 *
 * The catalogue quotes one price per model id, but a model id is served by many
 * upstreams at very different rates: this one spans 14x, $0.030/M to $0.440/M.
 * Estimating from the catalogue would have under-priced the pinned run by half,
 * which is a spend guard that does not guard.
 */
export async function fetchPrice(model: ModelConfig, apiKey: string): Promise<ModelPrice> {
  const response = await fetch(`${OPENROUTER_BASE_URL}/models/${model.model}/endpoints`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`could not read endpoint prices: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as {
    data: { endpoints: { tag: string; provider_name: string; pricing: ModelPrice }[] };
  };
  const endpoint = body.data.endpoints.find((e) => e.tag === model.upstreamProvider);
  if (!endpoint) {
    const available = body.data.endpoints.map((e) => e.tag).join(", ");
    throw new Error(
      `${model.upstreamProvider} does not serve ${model.model}. Available: ${available}`,
    );
  }
  return {
    prompt: Number(endpoint.pricing.prompt),
    completion: Number(endpoint.pricing.completion),
  };
}

export function estimateCost<TSubject>(
  subjects: TSubject[],
  gate: Gate<TSubject, unknown>,
  price: ModelPrice,
): number {
  let total = 0;
  for (const subject of subjects) {
    const chars = gate.buildMessages(subject).reduce((sum, m) => sum + m.content.length, 0);
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

/**
 * The check both paid entry points run before spending anything.
 *
 * Shared rather than repeated, so the cap can never be enforced in one place and
 * not the other: a run that cannot afford itself must fail the same way whether
 * it was started by the CLI or by the eval harness.
 */
export async function preflight<TSubject>(
  subjects: TSubject[],
  gate: Gate<TSubject, unknown>,
  model: ModelConfig,
  apiKey: string,
): Promise<{ price: ModelPrice; check: BudgetCheck }> {
  const price = await fetchPrice(model, apiKey);
  const check = checkBudget(
    spentSoFar(RUNS_DIR),
    estimateCost(subjects, gate, price),
    PILOT_BUDGET_USD,
  );
  return { price, check };
}
