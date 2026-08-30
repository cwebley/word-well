// Persistence keyed by the full config fingerprint.
//
// This is not a response cache and is not the same job as Braintrust's. This
// exists so an unchanged configuration never has to be paid for twice, which is
// what makes "try it on five cases first" a safe habit rather than a tax. Any
// change to a source, rule, model, prompt, rubric or contract produces a new
// key and therefore a new paid call, which is the correct outcome.
//
// Braintrust's own response caching is a different tool for a different moment:
// useful while iterating on prompt text, and wrong when measuring repeated-run
// reliability, where it would manufacture agreement.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Finding } from "./contract.ts";
import type { ConfigFingerprint } from "./fingerprint.ts";
import { fingerprintKey } from "./fingerprint.ts";
import type { DispositionResult } from "./policy.ts";

export interface Usage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  /** Cost in USD as the provider reported it, not as we estimated it. */
  cost_usd: number | null;
}

export interface AdjudicationRecord {
  claim_id: string;
  fingerprint_key: string;
  fingerprint: ConfigFingerprint;
  recorded_at: string;
  /** Present only when the model returned output that satisfied the contract. */
  finding: Finding | null;
  /** The raw parsed JSON, retained even when invalid so failures stay inspectable. */
  raw: unknown;
  contract_error: string | null;
  morphology: DispositionResult | null;
  effective: (DispositionResult & { endorsementOverride: boolean }) | null;
  endorsements: number;
  /** The upstream OpenRouter actually routed to. Recorded even when unpinned,
   *  because "which machine answered" is otherwise unrecoverable after the fact. */
  served_by: string | null;
  usage: Usage;
  latency_ms: number;
}

export class RunStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  get(fingerprint: ConfigFingerprint): AdjudicationRecord | null {
    const path = this.path(fingerprintKey(fingerprint));
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as AdjudicationRecord;
  }

  put(record: AdjudicationRecord): void {
    writeFileSync(this.path(record.fingerprint_key), `${JSON.stringify(record, null, 2)}\n`);
  }
}

/** A run record shaped for a human reading `runs/`, not for a machine. */
export function summarise(record: AdjudicationRecord): string {
  const verdict = record.finding
    ? `${record.finding.analysis_support}; meanings ${record.finding.meanings
        .map((m) => m.predictability)
        .join(", ")}`
    : `CONTRACT FAILURE: ${record.contract_error}`;
  const disposition = record.effective
    ? `${record.effective.disposition}${record.effective.endorsementOverride ? " (endorsement override)" : ""}`
    : "none";
  return `${record.claim_id}\n  ${verdict}\n  disposition: ${disposition}\n  ${record.usage.total_tokens ?? "?"} tokens, $${record.usage.cost_usd ?? "?"}, ${record.latency_ms} ms`;
}
