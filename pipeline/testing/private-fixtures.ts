// Test-only helpers. Harmless values only; identities live in memory.
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import pg from "pg";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { applyMigrations } from "../../db/apply-migrations.mjs";
import { databaseConnection, inDatabase } from "../../db/connections.mjs";
import { createPrivateCrypto, type KeyReference } from "../storage/crypto.js";

export const REPO = resolve(import.meta.dirname, "../..");

export async function harmlessKeys() {
  const identities = new Map<string, string>();
  let available = true;
  const key = async (role: "storage" | "dataset"): Promise<KeyReference> => {
    const identity = await generateIdentity();
    const id = `ww-${role}-v1`;
    identities.set(id, identity);
    return { id, recipient: await identityToRecipient(identity) };
  };
  const storageKey = await key("storage");
  const datasetKey = await key("dataset");
  const crypto = createPrivateCrypto(async reference => {
    if (!available || !identities.has(reference.id)) throw new Error("harmless-error-marker-KEY");
    return identities.get(reference.id)!;
  });
  return { storageKey, datasetKey, crypto, identities, setAvailable: (value: boolean) => { available = value; } };
}

export function adminUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for private evaluation tests");
  return url;
}

function databaseUrl(name: string): string {
  return inDatabase(adminUrl(), name);
}

// Like runtime pools, fixture pools must handle idle-client errors. pg-pool's
// end promise can resolve before a socket closes, then forced disposal can
// terminate that closing connection. Query failures still reject normally.
export function fixturePool(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", () => {});
  return pool;
}

// A migrated throwaway database, separate from wordwell_dev and wordwell_test.
export async function testDatabase() {
  const name = `wordwell_private_test_${randomBytes(6).toString("hex")}`;
  const admin = fixturePool(databaseUrl("postgres"));
  await admin.query(`CREATE DATABASE ${name}`);
  const url = databaseUrl(name);
  await applyMigrations(url);
  return {
    adminUrl: url,
    pipelineUrl: inDatabase(databaseConnection("pipeline"), name),
    learnerUrl: inDatabase(databaseConnection("learner"), name),
    async drop() {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  };
}

export async function privateTempDir() {
  const root = await mkdtemp(resolve(tmpdir(), "ww-private-eval-test-"));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

export type ScriptedReply =
  | { status: number; body: string; headers?: Record<string, string> }
  | { throws: string }
  | { hang: true };
export type SentRequest = { url: string; headers: Record<string, string>; body: string };

// Counts every outbound request and answers from a script. Running past the
// script fails the test rather than inventing a reply.
export function scriptedFetch(script: ScriptedReply[]) {
  const sent: SentRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body) });
    const next = script.shift();
    if (!next) throw new Error("unscripted_request");
    if ("throws" in next) throw new Error(next.throws);
    if ("hang" in next) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
    return new Response(next.body, { status: next.status, headers: next.headers });
  };
  return { fetch, sent };
}

// Field names match saved live System One replies. `slur` adds the noul answer
// that the slur-sense configurations ask for.
export function jevReply(choice: "clear" | "blocked", blocked: number, overrides: Record<string, unknown> = {}, slur?: number, vulgar?: number): ScriptedReply {
  const clear = Math.round((1 - blocked) * 100) / 100;
  return { status: 200, body: JSON.stringify({
    model: "typesafe/jev-1.13-20260917",
    answers: {
      appropriateness: { type: "choice", choice, probabilities: { clear, blocked }, confidence: Math.max(clear, blocked) },
      ...(slur === undefined ? {} : { slur_sense: { type: "noul", noul: slur } }),
      ...(vulgar === undefined ? {} : { vulgar_sense: { type: "noul", noul: vulgar } })
    },
    usage: { input_tokens: 412, output_tokens: 20, cost: 0.000017304 },
    id: `gen-harmless-${randomBytes(4).toString("hex")}`, provider: "TypeSafe", ...overrides
  }) };
}
