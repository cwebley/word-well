import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { adjudicate, parseFinding } from "./adjudicate.ts";
import type { Claim } from "./claim.ts";
import { readClaims } from "./claim.ts";
import type { EvidenceManifest, ModelConfig } from "./fingerprint.ts";
import { readManifest } from "./fingerprint.ts";
import type { AdjudicationRecord } from "./store.ts";

const claims = readClaims("evidence/contract-test.claims.jsonl");
const manifest: EvidenceManifest = readManifest("evidence/contract-test.manifest.json");
const claim = claims.find((c) => c.claim_id.startsWith("rebut")) as Claim;

const model: ModelConfig = {
  provider: "openrouter",
  model: "test/model",
  upstreamProvider: "test-provider",
  temperature: 0,
  seed: null,
};

const validFinding = (claimId: string) => ({
  claim_id: claimId,
  analysis_support: "unsupported",
  analysis_rationale: "the root is an adverb",
  analysis_evidence_ids: ["oewn-but__4.02.01.."],
  meanings: claim.candidate.source_meanings.map((m) => ({
    sense_ids: [m.sense_id],
    predictability: "insufficient_evidence",
    evidence_ids: [],
    rationale: "the claimed root bears on neither meaning",
  })),
  diagnostic_confidence: 0.8,
});

// The runner appends every paid call to a spend ledger. These tests drive that
// path with a stubbed cost, so they get their own directory: the real ledger is
// the audit record for the pilot cap and must contain only real charges.
const ledgerDir = mkdtempSync(join(tmpdir(), "wordwell-ledger-"));

function stubClient(content: string) {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, cost: 0.0001 },
  });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

describe("parseFinding", () => {
  it("accepts output that satisfies the contract", () => {
    const result = parseFinding(JSON.stringify(validFinding(claim.claim_id)), claim.claim_id);
    expect(result.error).toBeNull();
    expect(result.finding?.analysis_support).toBe("unsupported");
  });

  it("keeps output that is not JSON, so the failure stays inspectable", () => {
    const result = parseFinding("I think re- plus but.", claim.claim_id);
    expect(result.finding).toBeNull();
    expect(result.raw).toBe("I think re- plus but.");
    expect(result.error).toContain("not JSON");
  });

  it("rejects a verdict outside the allowed vocabulary and keeps the raw output", () => {
    const bad = { ...validFinding(claim.claim_id), analysis_support: "probably_not" };
    const result = parseFinding(JSON.stringify(bad), claim.claim_id);
    expect(result.finding).toBeNull();
    expect(result.raw).toMatchObject({ analysis_support: "probably_not" });
  });

  it("rejects an answer attached to the wrong claim", () => {
    const result = parseFinding(JSON.stringify(validFinding("someone-else")), claim.claim_id);
    expect(result.finding).toBeNull();
    expect(result.error).toContain("claim identity lost");
  });
});

describe("adjudicate", () => {
  it("does not retry or repair output that violates the contract", async () => {
    const { client, create } = stubClient("not json at all");
    const { record } = await adjudicate(claim, client, model, manifest, undefined, ledgerDir);

    expect(create).toHaveBeenCalledTimes(1);
    expect(record.contract_error).toContain("not JSON");
    expect(record.finding).toBeNull();
    expect(record.morphology).toBeNull();
    // The failure still carries its cost and latency, so a model that fails
    // cheaply is not mistaken for one that costs nothing.
    expect(record.usage.cost_usd).toBe(0.0001);
  });

  it("derives a disposition from a valid finding", async () => {
    const { client } = stubClient(JSON.stringify(validFinding(claim.claim_id)));
    const { record } = await adjudicate(claim, client, model, manifest, undefined, ledgerDir);

    expect(record.morphology?.disposition).toBe("advance");
    expect(record.effective?.disposition).toBe("advance");
  });

  it("reuses a persisted record instead of paying for the same question twice", async () => {
    const { client, create } = stubClient(JSON.stringify(validFinding(claim.claim_id)));
    let saved: AdjudicationRecord | null = null;
    const store = {
      get: () => saved,
      put: (record: AdjudicationRecord) => {
        saved = record;
      },
    };

    const first = await adjudicate(claim, client, model, manifest, store as never, ledgerDir);
    const second = await adjudicate(claim, client, model, manifest, store as never, ledgerDir);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
