// The adjudication runner. One subject in, one structured finding out.
//
// This is the shared core: every gate's CLI and every gate's eval call
// `adjudicate`, so an experiment can never end up measuring a duplicate copy of
// a prompt or a contract. What varies between gates arrives as a `Gate` — what
// to send, how to read the reply, how policy decides — and everything that
// costs money or must not drift stays here.
//
// Baseline behaviour on failure is deliberate. Transport failures (timeouts,
// 5xx, rate limits) are retried by the SDK, because they say nothing about the
// model. Malformed or contract-violating output is NOT retried and NOT repaired:
// it is recorded as a failure and scored as one. A repair attempt is a separate
// later experiment with its own accuracy, latency and cost to measure.

import OpenAI from "openai";
import { wrapOpenAI } from "braintrust";

import { recordSpend } from "./budget.ts";
import { OPENROUTER_BASE_URL, RUNS_DIR } from "./config.ts";
import type { Gate } from "./gate.ts";
import { unchanged } from "./gate.ts";
import type { ConfigFingerprint, EvidenceManifest, ModelConfig } from "./fingerprint.ts";
import { buildFingerprint, fingerprintKey } from "./fingerprint.ts";
import type { AdjudicationRecord, RunStore, Usage } from "./store.ts";

export function createClient(apiKey: string): OpenAI {
  return wrapOpenAI(
    new OpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
      // Transport-level retries only. The SDK retries connection errors, 408,
      // 409, 429 and 5xx; it never retries a 200 whose body we then reject.
      maxRetries: 2,
    }),
  );
}

/**
 * OpenRouter accepts fields the OpenAI schema does not describe. `provider`
 * keeps routing from becoming a second changed variable — only upstreams that
 * honour every parameter are eligible, and a named one is pinned outright — and
 * `usage` asks for the cost actually charged rather than one we estimate from a
 * price list that may have moved.
 */
interface OpenRouterExtras {
  provider?: { order?: string[]; allow_fallbacks?: boolean; require_parameters?: boolean };
  usage?: { include: boolean };
}

export interface AdjudicationOutcome<TFinding> {
  record: AdjudicationRecord<TFinding>;
  reused: boolean;
}

export async function adjudicate<TSubject, TFinding>(
  subject: TSubject,
  gate: Gate<TSubject, TFinding>,
  client: OpenAI,
  model: ModelConfig,
  manifest: EvidenceManifest,
  store?: RunStore,
  runsDir: string = RUNS_DIR,
): Promise<AdjudicationOutcome<TFinding>> {
  const fingerprint = buildFingerprint(gate.inputDigest(subject), manifest, model, gate.versions);

  const stored = store?.get(fingerprint);
  if (stored) return { record: stored as AdjudicationRecord<TFinding>, reused: true };

  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & OpenRouterExtras = {
    model: model.model,
    messages: gate.buildMessages(subject),
    temperature: model.temperature,
    ...(model.seed === null ? {} : { seed: model.seed }),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: `${gate.name.replace(/-/g, "_")}_finding`,
        strict: true,
        schema: gate.jsonSchema,
      },
    },
    usage: { include: true },
    provider: {
      // require_parameters keeps OpenRouter from routing to an upstream that
      // ignores response_format, so a schema violation is never really a routing
      // decision in disguise. order + allow_fallbacks pin the machine that
      // answers, which is what makes the fingerprint mean anything.
      require_parameters: true,
      order: [model.upstreamProvider],
      allow_fallbacks: false,
    },
  };

  const startedAt = Date.now();
  const completion = await client.chat.completions.create(body);
  const latencyMs = Date.now() - startedAt;

  const record = buildRecord(subject, gate, fingerprint, completion, latencyMs);
  store?.put(record);
  // Logged even when nothing is persisted, so the cap sees every paid call.
  // The directory is injectable for the same reason the store is: a test that
  // exercises this path must not append fabricated spend to the real ledger.
  recordSpend(runsDir, {
    at: record.recorded_at,
    claim_id: record.claim_id,
    fingerprint_key: record.fingerprint_key,
    cost_usd: record.usage.cost_usd ?? 0,
    persisted: store !== undefined,
  });
  return { record, reused: false };
}

function buildRecord<TSubject, TFinding>(
  subject: TSubject,
  gate: Gate<TSubject, TFinding>,
  fingerprint: ConfigFingerprint,
  completion: OpenAI.Chat.ChatCompletion,
  latencyMs: number,
): AdjudicationRecord<TFinding> {
  const content = completion.choices[0]?.message.content ?? "";
  const { raw, finding, error } = gate.parse(content, subject);

  // The model's own view of what should happen never gets here: `decide` is
  // handed the finding, and each gate's contract forbids a disposition field.
  const decision = finding ? gate.decide(finding) : null;
  const effective = decision
    ? (gate.applyContext?.(decision, subject) ?? unchanged(decision))
    : null;

  return {
    gate: gate.name,
    claim_id: gate.subjectId(subject),
    fingerprint_key: fingerprintKey(fingerprint),
    fingerprint,
    recorded_at: new Date().toISOString(),
    finding,
    raw,
    contract_error: error,
    decision,
    effective,
    policy_context: gate.policyContext(subject),
    served_by: (completion as { provider?: string }).provider ?? null,
    usage: readUsage(completion),
    latency_ms: latencyMs,
  };
}

interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

export function readUsage(completion: OpenAI.Chat.ChatCompletion): Usage {
  const usage = completion.usage as OpenRouterUsage | undefined;
  return {
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    reasoning_tokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    total_tokens: usage?.total_tokens ?? null,
    cost_usd: usage?.cost ?? null,
  };
}
