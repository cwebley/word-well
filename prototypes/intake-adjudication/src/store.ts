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

import type { DispositionResult } from "./disposition.ts";
import type { ConfigFingerprint } from "./fingerprint.ts";
import { fingerprintKey } from "./fingerprint.ts";
import type { EffectiveDecision } from "./gate.ts";

export interface Usage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  /** Cost in USD as the provider reported it, not as we estimated it. */
  cost_usd: number | null;
}

export interface AdjudicationRecord<TFinding = unknown> {
  /** Which gate asked. Absent on records written before gates were named. */
  gate?: string;
  /** The subject's identifier: a claim id for morphology, a lemma for usefulness. */
  claim_id: string;
  fingerprint_key: string;
  fingerprint: ConfigFingerprint;
  recorded_at: string;
  /** Present only when the model returned output that satisfied the contract. */
  finding: TFinding | null;
  /** The raw parsed JSON, retained even when invalid so failures stay inspectable. */
  raw: unknown;
  contract_error: string | null;
  /** The gate's own disposition, before any policy context is applied. */
  decision: DispositionResult | null;
  effective: EffectiveDecision | null;
  /** Whatever the gate records for correlation. Morphology carries endorsements. */
  policy_context: Record<string, number>;
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
    return migrate(JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>);
  }

  put(record: AdjudicationRecord): void {
    writeFileSync(this.path(record.fingerprint_key), `${JSON.stringify(record, null, 2)}\n`);
  }
}

/**
 * Read-compatibility for the 24 records written before gates were named.
 *
 * Those carry `morphology` where a record now carries `decision`, and a flat
 * `endorsements` where it now carries `policy_context`. Rewriting the files
 * would be the tidier fix and the wrong one: they are the evidence behind the
 * stage 1 and stage 2 experiment records, and a re-run that silently scored
 * `undefined` against them would corrupt results the plan is built on.
 */
function migrate(stored: Record<string, unknown>): AdjudicationRecord {
  const record = { ...stored } as Record<string, unknown>;
  if (record.decision === undefined && record.morphology !== undefined) {
    record.decision = record.morphology;
    record.gate ??= "morphology";
  }
  if (record.policy_context === undefined && typeof record.endorsements === "number") {
    record.policy_context = { endorsements: record.endorsements };
  }
  const effective = record.effective as Record<string, unknown> | null | undefined;
  if (effective && effective.overridden === undefined) {
    record.effective = { ...effective, overridden: Boolean(effective.endorsementOverride) };
  }
  return record as unknown as AdjudicationRecord;
}

/** A run record shaped for a human reading `runs/`, not for a machine. */
export function summarise(record: AdjudicationRecord, verdictOf: (finding: never) => string): string {
  const verdict = record.finding
    ? verdictOf(record.finding as never)
    : `CONTRACT FAILURE: ${record.contract_error}`;
  const disposition = record.effective
    ? `${record.effective.disposition}${record.effective.overridden ? " (policy override)" : ""}`
    : "none";
  return `${record.claim_id}\n  ${verdict}\n  disposition: ${disposition}\n  ${record.usage.total_tokens ?? "?"} tokens, $${record.usage.cost_usd ?? "?"}, ${record.latency_ms} ms`;
}
