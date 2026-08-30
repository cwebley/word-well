// Configuration read from the environment. Nothing here has a default that can
// spend money: the model identifier is required, because "whatever the default
// is" is exactly the kind of unrecorded variable the plan forbids.

import type { ModelConfig } from "./fingerprint.ts";

export const PILOT_BUDGET_USD = 10;

const HINTS: Record<string, string> = {
  OPENROUTER_PROVIDER:
    "Run `npm run models -- <model-id>` to list the upstreams serving your model, then pin one.",
};

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    const hint = HINTS[name];
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in; .env.local is gitignored.` +
        (hint ? `\n  ${hint}` : ""),
    );
  }
  return value;
}

export function modelConfigFromEnv(): ModelConfig {
  return {
    provider: "openrouter",
    model: requireEnv("OPENROUTER_MODEL"),
    // Required, not optional. Stage 1 measured what unpinned routing costs: five
    // calls served by four different upstreams produced two different verdicts
    // under one fingerprint and a 4.9x cost spread. A persisted verdict that the
    // same configuration would not reproduce is worse than no persistence.
    upstreamProvider: requireEnv("OPENROUTER_PROVIDER"),
    temperature: Number(process.env.OPENROUTER_TEMPERATURE ?? 0),
    seed: process.env.OPENROUTER_SEED ? Number(process.env.OPENROUTER_SEED) : null,
  };
}
