// Shared stage executor (#6 as amended by #8, #12 and #15). Owns one attempt's
// lifecycle: durable attempt, conservative reservation, ledger dispatch
// intent, the physical request, accounting, encrypted raw reply, validation
// and terminal outcome. Production and evaluation call the same execute().
//
// Callers own claims: run one execute() per attempt at a time.
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PrivateError } from "../storage/crypto.js";
import type { AttemptRecord, PrivateStore, RequestRecord, ExecutionOwnership } from "../storage/postgres.js";
import type { ReceiptLedger } from "../storage/receipts.js";
import type { ModelAdapter } from "./model.js";
import type { StageDefinition } from "./stage.js";

export type ExecutionSettings = {
  requestTimeoutMs: number;
  maxTransportRetries: number;
  retryDelaysMs: number[];
  maxRetryWaitMs: number;
  // Conservative per-request bound from verified (or flagged) pricing.
  reservationNanoUsd: number;
};

export type PauseCode = "budget_exhausted" | "accounting_unavailable" | "storage_unavailable" | "retry_deferred";
export type ExecutionOutcome<Result> =
  | { attemptId: string; state: "valid"; result: Result }
  | { attemptId: string; state: "invalid" | "failed"; code: string }
  | { attemptId: string; state: "uncertain" | "response_lost" }
  // Not terminal: nothing was decided, and resume may continue later.
  | { attemptId: string; state: "paused"; code: PauseCode; nextEligibleAt?: string };

const STORAGE_RETRY_DELAYS_MS = [250, 1_000];

function retryAfterMs(header: string | null, at: Date): number | null {
  if (!header) return null;
  // Clamped to the column range; anything this long defers the retry anyway.
  const clamp = (ms: number) => Math.min(ms, 2_147_483_647);
  if (/^\d+$/.test(header.trim())) return clamp(Number(header.trim()) * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : clamp(Math.max(0, date - at.getTime()));
}

export function createStageExecutor(dependencies: {
  store: PrivateStore;
  ledger: ReceiptLedger;
  model: ModelAdapter;
  settings: ExecutionSettings;
  // Credential/setup checks apply only when dispatch is allowed. Ownership
  // remains separate so saved replies can terminalize without a provider key.
  beforeDispatch?: () => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}) {
  const { store, ledger, model, settings } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? (ms => new Promise<void>(done => setTimeout(done, ms)));

  // The reply is in memory: transient write failures retry with no new call.
  async function persist(work: () => Promise<void>): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try { return await work(); }
      catch (error) {
        if (!(error instanceof PrivateError) || error.code !== "storage_unavailable" || attempt >= STORAGE_RETRY_DELAYS_MS.length) throw error;
        await sleep(STORAGE_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  async function execute<Input, Result>(request: {
    experimentId?: string; runId?: string; attemptId: string; stage: StageDefinition<Input, Result>; input: Input;
    // Recovery may reconcile and validate saved work, but cannot dispatch.
    allowDispatch?: boolean;
    beforeDispatch?: () => Promise<void>;
    assertOwnership?: () => Promise<void>;
    ownership?: ExecutionOwnership;
    provenance?: unknown;
  }): Promise<ExecutionOutcome<Result>> {
    const { experimentId, runId, attemptId, stage } = request;
    if ((experimentId === undefined) === (runId === undefined)) throw new PrivateError("attempt_owner_invalid");
    const owner = runId ? { runId } : { experimentId: experimentId! };
    const body = stage.render(request.input);
    const saved = (attempt: AttemptRecord): ExecutionOutcome<Result> | null => {
      switch (attempt.status) {
        case "valid": return { attemptId, state: "valid", result: stage.resultSchema.parse(attempt.result) };
        case "invalid": case "failed": return { attemptId, state: attempt.status, code: attempt.outcomeCode ?? attempt.status };
        case "uncertain": case "response_lost": return { attemptId, state: attempt.status };
        default: return null;
      }
    };
    const finish = async (status: "valid" | "invalid" | "failed" | "uncertain" | "response_lost", outcomeCode: string | null, result?: Result) => {
      await request.assertOwnership?.();
      await persist(() => store.finishAttempt(attemptId, { status, outcomeCode, result }, request.ownership));
      return saved((await store.readAttempt(attemptId))!)!;
    };
    // Decide from the last saved exchange. The saved raw reply is the evidence,
    // so a crash after saving it re-validates rather than re-dispatching.
    const conclude = async (last: RequestRecord): Promise<ExecutionOutcome<Result> | null> => {
      if (last.status === "no_response") return finish("uncertain", "request_uncertain");
      if (last.retryable) return null;
      if (!last.response) return finish("response_lost", "response_lost");
      const classification = model.classify(last.response);
      if (classification.kind === "rejected") return finish("failed", classification.code);
      if (classification.kind !== "reply" || last.response.kind !== "response") return finish("uncertain", "request_uncertain");
      const validation = stage.validate(last.response.body);
      return validation.ok ? finish("valid", null, validation.result) : finish("invalid", validation.code);
    };

    try {
      let attempt = await store.readAttempt(attemptId);
      if (!attempt) {
        await persist(() => store.createAttempt({ id: attemptId, ...owner, stage: stage.name, input: { input: request.input, request: body,
          ...(request.provenance === undefined ? {} : { provenance: request.provenance }) } }));
        attempt = (await store.readAttempt(attemptId))!;
      } else if ((attempt.experimentId ?? undefined) !== experimentId || (attempt.runId ?? undefined) !== runId || attempt.stage !== stage.name || !isDeepStrictEqual(attempt.input.request, body)) {
        throw new PrivateError("attempt_input_mismatch");
      }
      // Reconcile with the ledger: restore receipts a failed append left out,
      // then settle reservations left by an interrupted process.
      const receipts = attempt.requests.length ? (await ledger.read()).filter(event => event.attemptId === attemptId) : [];
      for (const receipt of receipts) {
        if (receipt.type === "request_outcome" && receipt.chargeNanoUsd !== null && attempt.requests.some(r => r.id === receipt.requestId && r.chargeStatus === "unknown"))
          await store.reconcileRequestAccounting(receipt.requestId, { ...receipt, chargeNanoUsd: receipt.chargeNanoUsd });
      }
      attempt = (await store.readAttempt(attemptId))!;
      for (const settled of attempt.requests.filter(r => r.status === "responded" || r.status === "no_response")) {
        if (receipts.some(event => event.type === "request_outcome" && event.requestId === settled.id)) continue;
        try {
          await ledger.append({
            type: "request_outcome", eventId: randomUUID(), at: (settled.completedAt ?? now()).toISOString(), ...owner, attemptId,
            requestId: settled.id, outcome: settled.status as "responded" | "no_response", httpStatus: settled.httpStatus,
            generationId: settled.generationId, inputTokens: settled.inputTokens, outputTokens: settled.outputTokens,
            chargeStatus: settled.chargeNanoUsd === null ? "unknown" : "known", chargeNanoUsd: settled.chargeNanoUsd
          });
        } catch { return { attemptId, state: "paused", code: "accounting_unavailable" }; }
      }
      const done = saved(attempt);
      if (done) return done;
      const cancelled = receipts.find(event => event.type === "dispatch_cancelled");
      if (cancelled) {
        await persist(() => store.abandonRequest(cancelled.requestId, true));
        return finish("failed", "dispatch_cancelled");
      }

      const open = attempt.requests.filter(r => r.status === "reserved");
      if (open.length) {
        for (const pending of open) {
          const intent = receipts.find(event => event.type === "dispatch_intent" && event.requestId === pending.id);
          const outcome = receipts.find(event => event.type === "request_outcome" && event.requestId === pending.id);
          if (!intent) { await persist(() => store.abandonRequest(pending.id)); continue; }
          if (outcome?.type === "request_outcome") {
            await persist(() => store.recordOutcome(pending.id, {
              status: outcome.outcome, httpStatus: outcome.httpStatus, retryable: null, retryAfterMs: null,
              generationId: outcome.generationId, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens,
              chargeNanoUsd: outcome.chargeNanoUsd, completedAt: new Date(outcome.at)
            }));
            return finish(outcome.outcome === "no_response" ? "uncertain" : "response_lost", outcome.outcome === "no_response" ? "request_uncertain" : "response_lost");
          }
          // Intent without outcome: it may have been sent and charged. Never redispatch.
          await persist(() => store.recordOutcome(pending.id, {
            status: "no_response", httpStatus: null, retryable: null, retryAfterMs: null,
            generationId: null, inputTokens: null, outputTokens: null, chargeNanoUsd: null, completedAt: now()
          }));
          return finish("uncertain", "request_uncertain");
        }
        attempt = (await store.readAttempt(attemptId))!;
      }

      while (true) {
        const sent = attempt.requests.filter(r => r.status !== "abandoned");
        const last = sent.at(-1);
        if (last) {
          const decided = await conclude(last);
          if (decided) return decided;
          // Retry allowance is counted from durable rows, so restart cannot reset it.
          if (sent.length > settings.maxTransportRetries) return finish("failed", "retries_exhausted");
          const delay = Math.max(settings.retryDelaysMs[sent.length - 1] ?? 0, last.retryAfterMs ?? 0);
          const eligible = new Date(last.completedAt!.getTime() + delay);
          const wait = eligible.getTime() - now().getTime();
          if (wait > settings.maxRetryWaitMs) {
            await persist(() => store.deferAttempt(attemptId, eligible));
            return { attemptId, state: "paused", code: "retry_deferred", nextEligibleAt: eligible.toISOString() };
          }
          if (wait > 0) await sleep(wait);
        }

        if (request.allowDispatch === false) return { attemptId, state: "paused", code: "retry_deferred" };
        await dependencies.beforeDispatch?.();
        await request.beforeDispatch?.();
        const requestId = randomUUID();
        const sequence = attempt.requests.length + 1;
        const reserved = await store.reserveRequest({ requestId, attemptId, ...owner, sequence, reservedNanoUsd: settings.reservationNanoUsd, at: now() });
        if (!reserved) return { attemptId, state: "paused", code: "budget_exhausted" };
        try {
          await ledger.append({ type: "dispatch_intent", eventId: randomUUID(), at: now().toISOString(), ...owner, attemptId, requestId, sequence, reservedNanoUsd: settings.reservationNanoUsd });
        } catch {
          await persist(() => store.abandonRequest(requestId));
          return { attemptId, state: "paused", code: "accounting_unavailable" };
        }

        try { await dependencies.beforeDispatch?.(); await request.beforeDispatch?.(); }
        catch {
          // The physical send has not begun. Cancellation must be durable so
          // restart does not mistake the preceding intent for a sent request.
          try { await ledger.append({ type: "dispatch_cancelled", eventId: randomUUID(), at: now().toISOString(), ...owner, attemptId, requestId }); }
          catch { return { attemptId, state: "paused", code: "accounting_unavailable" }; }
          await persist(() => store.abandonRequest(requestId, true));
          return finish("failed", "dispatch_cancelled");
        }
        const exchange = await model.send(body, { timeoutMs: settings.requestTimeoutMs });
        const completedAt = now();
        const accounting = model.accounting(exchange);
        const classification = model.classify(exchange);
        let accountingFailed = false;
        try {
          await ledger.append({
            type: "request_outcome", eventId: randomUUID(), at: completedAt.toISOString(), ...owner, attemptId, requestId,
            outcome: exchange.kind === "response" ? "responded" : "no_response",
            httpStatus: exchange.kind === "response" ? exchange.status : null,
            ...accounting, chargeStatus: accounting.chargeNanoUsd === null ? "unknown" : "known"
          });
        } catch { accountingFailed = true; }
        await persist(() => store.recordOutcome(requestId, {
          status: exchange.kind === "response" ? "responded" : "no_response",
          httpStatus: exchange.kind === "response" ? exchange.status : null,
          retryable: classification.kind === "retryable",
          retryAfterMs: exchange.kind === "response" ? retryAfterMs(exchange.retryAfter, completedAt) : null,
          ...accounting, completedAt, response: exchange
        }));
        attempt = (await store.readAttempt(attemptId))!;
        const decided = await conclude(attempt.requests.at(-1)!);
        // Durable accounting is unavailable: keep what was saved, dispatch nothing more.
        if (accountingFailed) return { attemptId, state: "paused", code: "accounting_unavailable" };
        if (decided) return decided;
      }
    } catch (error) {
      if (error instanceof PrivateError && error.code === "storage_unavailable")
        return { attemptId, state: "paused", code: "storage_unavailable" };
      if (error instanceof PrivateError && (error.code === "accounting_unavailable" || error.code === "ledger_invalid"))
        return { attemptId, state: "paused", code: "accounting_unavailable" };
      throw error;
    }
  }

  return { execute };
}
export type StageExecutor = ReturnType<typeof createStageExecutor>;
