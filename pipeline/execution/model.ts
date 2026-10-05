// The model adapter interface. A future configuration on another route adds
// an adapter here; the executor, storage and accounting stay the same.
export type Exchange =
  | { kind: "response"; status: number; body: string; retryAfter: string | null; contentType: string | null }
  // The request may or may not have reached the provider, or been charged.
  | { kind: "no_response"; reason: "timeout" | "network" };

// Null charge means unknown, never zero.
export type Accounting = { generationId: string | null; inputTokens: number | null; outputTokens: number | null; chargeNanoUsd: number | null };

export type Classification =
  | { kind: "reply" }
  | { kind: "retryable" }
  | { kind: "rejected"; code: string }
  | { kind: "uncertain" };

export interface ModelAdapter {
  readonly route: string;
  send(body: unknown, options: { timeoutMs: number }): Promise<Exchange>;
  accounting(exchange: Exchange): Accounting;
  classify(exchange: Exchange): Classification;
}
