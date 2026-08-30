// Stage 1 of the plan: the contract test. Five hand-picked mechanical claims,
// one cheap model, one question — does the whole path hold together?
//
// Fixed evidence in, one OpenRouter call, a structured finding, a deterministic
// disposition, a persisted record, a Braintrust trace, deterministic scores.
// Nothing here is trying to find out whether the model is any good; the case
// count is far too small and the labels are provisional. It is trying to find
// out whether the next experiment would be measuring what it thinks it is.
//
// Run with:
//   npm run eval

import { join } from "node:path";

import { Eval } from "braintrust";

import { adjudicate, createClient } from "../src/adjudicate.ts";
import { checkBudget, estimateCost, fetchPrice, spentSoFar } from "../src/budget.ts";
import type { Claim } from "../src/claim.ts";
import { readClaims } from "../src/claim.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "../src/config.ts";
import { readManifest } from "../src/fingerprint.ts";
import type { AdjudicationRecord } from "../src/store.ts";
import { RunStore } from "../src/store.ts";
import { contractScorers } from "./scorers/contract.ts";
import { policyScorers } from "./scorers/policy.ts";
import { semanticScorers } from "./scorers/semantic.ts";
import type { ExpectedLabel } from "./types.ts";
import { readLabels } from "./types.ts";

const CASE_SET = process.env.CASE_SET ?? "contract-test";
const RUNS_DIR = "runs";

const apiKey = requireEnv("OPENROUTER_API_KEY");
const model = modelConfigFromEnv();
const claims = readClaims(join("evidence", `${CASE_SET}.claims.jsonl`));
const manifest = readManifest(join("evidence", `${CASE_SET}.manifest.json`));
const labels = readLabels(join("labels", `${CASE_SET}.labels.jsonl`));

const client = createClient(apiKey);
const store = new RunStore(RUNS_DIR);

// The braintrust CLI bundles this file as CJS, so the spend guard cannot run at
// the top level. It runs inside `data` instead, which is awaited before any task
// starts: a run that cannot afford itself still makes no calls.
Eval<Claim, AdjudicationRecord, ExpectedLabel>("WordWell morphology adjudication", {
  experimentName: `${CASE_SET} · ${model.model}`,
  metadata: {
    stage: "1 — contract test",
    case_set: CASE_SET,
    issue: "https://github.com/cwebley/word-well/issues/48",
    model: model.model,
    upstream_provider: model.upstreamProvider,
    temperature: model.temperature,
    extraction_version: manifest.extraction_version,
    pool_sha256: manifest.sources.candidate_pool.sha256,
    label_status: "provisional-unvalidated",
  },

  data: async () => {
    const price = await fetchPrice(model, apiKey);
    const budget = checkBudget(spentSoFar(RUNS_DIR), estimateCost(claims, price), PILOT_BUDGET_USD);
    if (!budget.allowed) {
      throw new Error(
        `estimate $${budget.estimate.toFixed(4)} exceeds the $${budget.remaining.toFixed(4)} left of the $${PILOT_BUDGET_USD} pilot cap`,
      );
    }

    return claims.map((claim) => {
      const expected = labels.get(claim.claim_id);
      if (!expected) throw new Error(`no label for ${claim.claim_id}`);
      return {
        input: claim,
        expected,
        // Prices ride on each case so the experiment carries the numbers the
        // decision was made with, not the ones in force whenever it is reread.
        metadata: {
          claim_id: claim.claim_id,
          rule_kind: claim.claim.rule_kind,
          slice: expected.slice,
          meaning_count: claim.candidate.source_meanings.length,
          endorsements: claim.policy_context.endorsements,
          missing_evidence: claim.missing_evidence,
          price_prompt_usd_per_token: price.prompt,
          price_completion_usd_per_token: price.completion,
          estimated_cost_usd: budget.estimate,
        },
      };
    });
  },

  task: async (claim, hooks) => {
    const { record, reused } = await adjudicate(claim, client, model, manifest, store);

    // Token, cost and latency come from the provider's own accounting rather
    // than an estimate, so the full-pool projection later is built on measured
    // numbers. A reused record contributes no new spend.
    hooks.span.log({
      metrics: {
        prompt_tokens: record.usage.prompt_tokens ?? 0,
        completion_tokens: record.usage.completion_tokens ?? 0,
        reasoning_tokens: record.usage.reasoning_tokens ?? 0,
        total_tokens: record.usage.total_tokens ?? 0,
        // Two costs, because they answer different questions: what this run
        // spent (nothing, if the record was reused) and what the answer cost
        // when it was first paid for, which is what a full-pool projection
        // must be built from.
        cost_usd: reused ? 0 : (record.usage.cost_usd ?? 0),
        recorded_cost_usd: record.usage.cost_usd ?? 0,
        latency_ms: record.latency_ms,
      },
    });
    hooks.metadata.fingerprint_key = record.fingerprint_key;
    hooks.metadata.served_by = record.served_by;
    hooks.metadata.reused_persisted_record = reused;
    hooks.metadata.contract_error = record.contract_error;

    return record;
  },

  scores: [...contractScorers, ...semanticScorers, ...policyScorers],
});
