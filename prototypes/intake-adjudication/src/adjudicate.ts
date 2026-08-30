// The adjudication runner. One claim in, one structured finding out.
//
// This is the shared core: the Braintrust eval and any later workflow prototype
// both call `adjudicate`, so an experiment can never end up measuring a
// duplicate copy of the prompt or the contract.
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
import type { Claim } from "./claim.ts";
import type { Finding } from "./contract.ts";
import { CONTRACT_VERSION, findingJsonSchema, findingSchema } from "./contract.ts";
import type { ConfigFingerprint, EvidenceManifest, ModelConfig } from "./fingerprint.ts";
import { buildFingerprint, fingerprintKey } from "./fingerprint.ts";
import { applyEndorsement, deriveMorphologyDisposition, verdictOf } from "./policy.ts";
import { buildMessages } from "./prompt.ts";
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

export interface AdjudicationOutcome {
  record: AdjudicationRecord;
  reused: boolean;
}

export async function adjudicate(
  claim: Claim,
  client: OpenAI,
  model: ModelConfig,
  manifest: EvidenceManifest,
  store?: RunStore,
): Promise<AdjudicationOutcome> {
  const fingerprint = buildFingerprint(claim.input_digest, manifest, model);

  const stored = store?.get(fingerprint);
  if (stored) return { record: stored, reused: true };

  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & OpenRouterExtras = {
    model: model.model,
    messages: buildMessages(claim),
    temperature: model.temperature,
    ...(model.seed === null ? {} : { seed: model.seed }),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "morphology_finding",
        strict: true,
        schema: findingJsonSchema as Record<string, unknown>,
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

  const record = buildRecord(claim, fingerprint, completion, latencyMs);
  store?.put(record);
  // Logged even when nothing is persisted, so the cap sees every paid call.
  recordSpend(RUNS_DIR, {
    at: record.recorded_at,
    claim_id: record.claim_id,
    fingerprint_key: record.fingerprint_key,
    cost_usd: record.usage.cost_usd ?? 0,
    persisted: store !== undefined,
  });
  return { record, reused: false };
}

function buildRecord(
  claim: Claim,
  fingerprint: ConfigFingerprint,
  completion: OpenAI.Chat.ChatCompletion,
  latencyMs: number,
): AdjudicationRecord {
  const content = completion.choices[0]?.message.content ?? "";
  const { raw, finding, error } = parseFinding(content, claim.claim_id);

  const morphology = finding ? deriveMorphologyDisposition(verdictOf(finding)) : null;
  const effective = morphology
    ? applyEndorsement(morphology, claim.policy_context.endorsements)
    : null;

  return {
    claim_id: claim.claim_id,
    fingerprint_key: fingerprintKey(fingerprint),
    fingerprint,
    recorded_at: new Date().toISOString(),
    finding,
    raw,
    contract_error: error,
    morphology,
    effective,
    endorsements: claim.policy_context.endorsements,
    served_by: (completion as { provider?: string }).provider ?? null,
    usage: readUsage(completion),
    latency_ms: latencyMs,
  };
}

export function parseFinding(
  content: string,
  expectedClaimId: string,
): { raw: unknown; finding: Finding | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { raw: content, finding: null, error: `output was not JSON (${CONTRACT_VERSION})` };
  }

  const parsed = findingSchema.safeParse(raw);
  if (!parsed.success) {
    return { raw, finding: null, error: parsed.error.issues.map(issueLine).join("; ") };
  }
  if (parsed.data.claim_id !== expectedClaimId) {
    return {
      raw,
      finding: null,
      error: `claim identity lost: expected ${expectedClaimId}, got ${parsed.data.claim_id}`,
    };
  }
  return { raw, finding: parsed.data, error: null };
}

function issueLine(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
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
