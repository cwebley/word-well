// Accounting-only ledger, separate from PostgreSQL (#6, #8). Append-only and
// fsynced per event. Strict schemas admit only opaque identities, fixed codes,
// counts, amounts and times: no prompts, headwords, replies or error text.
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { PrivateError } from "./crypto.js";
import { privateDirectory, readBytes, syncDirectory } from "./files.js";

const ids = {
  eventId: z.uuid(), at: z.iso.datetime(), experimentId: z.uuid(), attemptId: z.uuid(), requestId: z.uuid()
};
const nano = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const tokens = z.number().int().nonnegative().max(10_000_000).nullable();

export const receiptSchema = z.discriminatedUnion("type", [
  z.object({
    schema: z.literal("wordwell-receipt-v1"), type: z.literal("dispatch_intent"), ...ids,
    sequence: z.number().int().min(1).max(32767), reservedNanoUsd: nano
  }).strict(),
  z.object({
    schema: z.literal("wordwell-receipt-v1"), type: z.literal("request_outcome"), ...ids,
    outcome: z.enum(["responded", "no_response"]),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    generationId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).nullable(),
    inputTokens: tokens, outputTokens: tokens,
    chargeStatus: z.enum(["known", "unknown"]),
    chargeNanoUsd: nano.nullable()
  }).strict().refine(event => (event.chargeStatus === "known") === (event.chargeNanoUsd !== null))
]);
export type Receipt = z.infer<typeof receiptSchema>;
type Distribute<T> = T extends unknown ? Omit<T, "schema"> : never;
export type ReceiptInput = Distribute<Receipt>;

export async function createReceiptLedger(options: {
  directory: string; checkout: string;
  // Internal fault-injection seam for tests.
  beforeAppend?: (type: Receipt["type"]) => Promise<void>;
}) {
  const directory = await privateDirectory(options.directory, options.checkout);
  const path = resolve(directory, "receipts.jsonl");
  return {
    async append(input: ReceiptInput): Promise<void> {
      try {
        const event = receiptSchema.parse({ schema: "wordwell-receipt-v1", ...input });
        await options.beforeAppend?.(event.type);
        let created = false;
        try { await lstat(path); } catch { created = true; }
        const file = await open(path, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
        try {
          // Never append after a torn line; that would corrupt a complete event.
          const { size } = await file.stat();
          if (size > 0) {
            const last = Buffer.alloc(1);
            await file.read(last, 0, 1, size - 1);
            if (last[0] !== 0x0a) throw new PrivateError("ledger_invalid");
          }
          await file.writeFile(JSON.stringify(event) + "\n"); await file.sync();
        } finally { await file.close(); }
        if (created) await syncDirectory(directory);
      } catch { throw new PrivateError("accounting_unavailable"); }
    },
    // Duplicate-safe: repeated event IDs collapse. A torn final line from a
    // crash mid-append is ignored; any other malformed line stops reading.
    async read(): Promise<Receipt[]> {
      let text: string;
      try { text = (await readBytes(path)).toString("utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new PrivateError("accounting_unavailable");
      }
      const lines = text.split("\n");
      lines.pop();
      const events = new Map<string, Receipt>();
      for (const line of lines) {
        const parsed = (() => { try { return receiptSchema.safeParse(JSON.parse(line)); } catch { return null; } })();
        if (!parsed?.success) throw new PrivateError("ledger_invalid");
        if (!events.has(parsed.data.eventId)) events.set(parsed.data.eventId, parsed.data);
      }
      return [...events.values()];
    }
  };
}
export type ReceiptLedger = Awaited<ReturnType<typeof createReceiptLedger>>;
