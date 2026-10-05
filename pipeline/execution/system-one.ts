// OpenRouter System One adapter (approved on #15 in place of the AI SDK, which
// cannot call this route). Plain fetch never retries; the executor owns every
// retry. The adapter returns the exchange exactly as received.
import type { ModelAdapter, Exchange, Accounting, Classification } from "./model.js";

export const SYSTEM_ONE_ENDPOINT = "https://openrouter.ai/api/v1/systemone";
export const SYSTEM_ONE_ROUTE = "openrouter-systemone-v1";

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

function failureFor(status: number): Classification {
  if (RETRYABLE.has(status)) return { kind: "retryable" };
  if (status === 401 || status === 403) return { kind: "rejected", code: "credentials_rejected" };
  if (status === 402) return { kind: "rejected", code: "insufficient_credits" };
  if ([400, 404, 405, 413, 422].includes(status)) return { kind: "rejected", code: "request_rejected" };
  return { kind: "rejected", code: "http_error" };
}

function json(body: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;

export function createSystemOneAdapter({ apiKey, fetch = globalThis.fetch }: { apiKey: string; fetch?: typeof globalThis.fetch }): ModelAdapter {
  return {
    route: SYSTEM_ONE_ROUTE,
    async send(body, { timeoutMs }): Promise<Exchange> {
      try {
        const response = await fetch(SYSTEM_ONE_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // Trials must be fresh judgments, never a cached reply.
            "X-OpenRouter-Cache": "false"
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        });
        // A body that fails mid-read may still have been charged.
        const text = await response.text();
        return {
          kind: "response", status: response.status, body: text,
          retryAfter: response.headers.get("retry-after"), contentType: response.headers.get("content-type")
        };
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        return { kind: "no_response", reason: name === "TimeoutError" ? "timeout" : "network" };
      }
    },
    accounting(exchange): Accounting {
      const empty: Accounting = { generationId: null, inputTokens: null, outputTokens: null, chargeNanoUsd: null };
      if (exchange.kind !== "response") return empty;
      const data = json(exchange.body);
      if (!data) return empty;
      const usage = data.usage && typeof data.usage === "object" ? data.usage as Record<string, unknown> : {};
      const cost = usage.cost;
      const id = typeof data.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(data.id) ? data.id : null;
      return {
        generationId: id,
        inputTokens: count(usage.input_tokens),
        outputTokens: count(usage.output_tokens),
        // Unknown cost stays null, never zero.
        chargeNanoUsd: typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 1e9) : null
      };
    },
    classify(exchange): Classification {
      if (exchange.kind !== "response") return { kind: "uncertain" };
      if (exchange.status < 200 || exchange.status >= 300) return failureFor(exchange.status);
      // OpenRouter can report a generation error inside HTTP 200.
      const error = json(exchange.body)?.error;
      if (error && typeof error === "object") {
        const code = (error as Record<string, unknown>).code;
        return typeof code === "number" ? failureFor(code) : { kind: "rejected", code: "provider_error" };
      }
      return { kind: "reply" };
    }
  };
}
