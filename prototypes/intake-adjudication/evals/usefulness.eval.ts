// Stage 3: the audience-usefulness gate's baseline run.
//
// Twelve headwords, nineteen meanings, one cheap model, a prompt close to one
// sentence. This is not trying to find out whether the model is good at the
// question — twelve cases labelled by one person cannot answer that. It is
// establishing the baseline the prompt gets improved against, and finding out
// which rejects a thin prompt lets through.
//
// Run with:
//   npm run eval:usefulness

import { Eval } from "braintrust";

import { createClient } from "../src/adjudicate.ts";
import { preflight } from "../src/budget.ts";
import { modelConfigFromEnv, PILOT_BUDGET_USD, requireEnv } from "../src/config.ts";
import { RunStore } from "../src/store.ts";
import { usefulnessGate } from "../src/usefulness/gate.ts";
import type { HeadwordGroup, HeadwordOutcome } from "../src/usefulness/run.ts";
import { judgeHeadword } from "../src/usefulness/run.ts";
import { loadUsefulnessDataset } from "./usefulness-datasets.ts";
import type { UsefulnessCase } from "./usefulness-datasets.ts";
import { usefulnessContractScorers } from "./scorers/usefulness-contract.ts";
import { usefulnessSemanticScorers } from "./scorers/usefulness-semantic.ts";

const CASE_SET = process.env.CASE_SET ?? "usefulness-golden-v1";
const RUNS_DIR = "runs";

const apiKey = requireEnv("OPENROUTER_API_KEY");
const model = modelConfigFromEnv();
const dataset = loadUsefulnessDataset(CASE_SET);
const meanings = dataset.cases.flatMap(({ group }) => group.meanings);

const client = createClient(apiKey);
const store = new RunStore(RUNS_DIR);

// The braintrust CLI bundles this file as CJS, so the spend guard cannot run at
// the top level. It runs inside `data` instead, which is awaited before any task
// starts: a run that cannot afford itself still makes no calls.
Eval<HeadwordGroup, HeadwordOutcome, UsefulnessCase["expected"]>(
  "WordWell audience-usefulness adjudication",
  {
    experimentName: `${CASE_SET} · ${model.model}`,
    metadata: {
      stage: "3 — usefulness baseline",
      case_set: CASE_SET,
      set_version: dataset.setVersion,
      issue: "https://github.com/cwebley/word-well/issues/56",
      model: model.model,
      upstream_provider: model.upstreamProvider,
      temperature: model.temperature,
      extraction_version: dataset.manifest.extraction_version,
      pool_sha256: dataset.manifest.sources.candidate_pool.sha256,
      prompt_version: usefulnessGate.versions.prompt,
      rubric_version: usefulnessGate.versions.rubric,
      label_status: "human-validated",
    },

    data: async () => {
      // Estimated over meanings, because meanings are what get paid for.
      const { price, check: budget } = await preflight(meanings, usefulnessGate, model, apiKey);
      if (!budget.allowed) {
        throw new Error(
          `estimate $${budget.estimate.toFixed(4)} exceeds the $${budget.remaining.toFixed(4)} left of the $${PILOT_BUDGET_USD} pilot cap`,
        );
      }

      return dataset.cases.map(({ group, expected }) => ({
        input: group,
        expected,
        // Prices ride on each case so the experiment carries the numbers the
        // decision was made with, not the ones in force whenever it is reread.
        metadata: {
          lemma: expected.lemma,
          display: group.display,
          bucket: expected.bucket,
          slice: expected.reason,
          meaning_count: group.meanings.length,
          zipf: group.meanings[0]?.candidate.zipf ?? null,
          endorsements: group.meanings[0]?.policy_context.endorsements ?? 0,
          price_prompt_usd_per_token: price.prompt,
          price_completion_usd_per_token: price.completion,
          estimated_cost_usd: budget.estimate,
        },
      }));
    },

    task: async (group, hooks) => {
      const outcome = await judgeHeadword(group, client, model, dataset.manifest, store);

      const sum = (pick: (r: HeadwordOutcome["records"][number]) => number | null) =>
        outcome.records.reduce((total, record) => total + (pick(record) ?? 0), 0);

      hooks.span.log({
        metrics: {
          calls: outcome.records.length,
          prompt_tokens: sum((r) => r.usage.prompt_tokens),
          completion_tokens: sum((r) => r.usage.completion_tokens),
          reasoning_tokens: sum((r) => r.usage.reasoning_tokens),
          total_tokens: sum((r) => r.usage.total_tokens),
          // Two costs, because they answer different questions: what this run
          // spent (nothing, for a reused record) and what the answer cost when
          // it was first paid for, which is what a projection must be built on.
          cost_usd: outcome.reusedCount === outcome.records.length ? 0 : sum((r) => r.usage.cost_usd),
          recorded_cost_usd: sum((r) => r.usage.cost_usd),
          latency_ms: sum((r) => r.latency_ms),
        },
      });
      hooks.metadata.fingerprint_keys = outcome.records.map((r) => r.fingerprint_key);
      hooks.metadata.served_by = outcome.records[0]?.served_by ?? null;
      hooks.metadata.reused_persisted_records = outcome.reusedCount;
      hooks.metadata.contract_errors = outcome.records
        .map((r) => r.contract_error)
        .filter((error): error is string => error !== null);
      hooks.metadata.disposition = outcome.decision.disposition;

      return outcome;
    },

    scores: [...usefulnessContractScorers, ...usefulnessSemanticScorers],
  },
);
