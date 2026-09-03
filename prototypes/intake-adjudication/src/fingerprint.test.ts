import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildFingerprint, canonicalJson, fingerprintKey, readManifest } from "./fingerprint.ts";
import type { ConfigFingerprint, EvidenceManifest, ModelConfig } from "./fingerprint.ts";
import { morphologyGate } from "./morphology/gate.ts";

const manifest: EvidenceManifest = readManifest("evidence/contract-test.manifest.json");
const model: ModelConfig = {
  provider: "openrouter",
  model: "test/model",
  upstreamProvider: "test-provider",
  temperature: 0,
  seed: null,
};

const key = (m: EvidenceManifest = manifest, c: ModelConfig = model, digest = "abc") =>
  fingerprintKey(buildFingerprint(digest, m, c, morphologyGate.versions));

describe("config fingerprint", () => {
  it("does not depend on key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("is stable for an unchanged configuration", () => {
    expect(key()).toBe(key());
  });

  it("changes when the claim's evidence changes", () => {
    expect(key(manifest, model, "different-digest")).not.toBe(key());
  });

  it("changes when the model or its upstream provider changes", () => {
    expect(key(manifest, { ...model, model: "other/model" })).not.toBe(key());
    expect(key(manifest, { ...model, upstreamProvider: "somewhere-else" })).not.toBe(key());
    expect(key(manifest, { ...model, temperature: 0.7 })).not.toBe(key());
  });

  it("changes when the pinned sources change under an identical prompt", () => {
    const rebuilt: EvidenceManifest = {
      ...manifest,
      sources: {
        ...manifest.sources,
        candidate_pool: { ...manifest.sources.candidate_pool, sha256: "a-different-pool" },
      },
    };
    expect(key(rebuilt)).not.toBe(key());
  });

  it("changes when the deterministic rules change under an identical prompt", () => {
    const rebuilt: EvidenceManifest = {
      ...manifest,
      deterministic_rules: { source: "build_pool.py", sha256: "rules-were-edited" },
    };
    expect(key(rebuilt)).not.toBe(key());
  });

  it("changes when the extractor changes under an identical prompt", () => {
    expect(key({ ...manifest, extraction_version: "intake-evidence/2" })).not.toBe(key());
  });
});

// The guard that makes gate-parameterising the fingerprint safe.
//
// Every committed run record carries both the fingerprint it was keyed under and
// the key itself. If a refactor adds, removes or renames a field, or changes how
// the hash is taken, these stop agreeing and every persisted answer silently
// becomes unreachable — the store would miss, and the pilot budget would pay
// again for questions already answered.
describe("committed run records", () => {
  const records = readdirSync("runs")
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({
      name,
      record: JSON.parse(readFileSync(join("runs", name), "utf-8")) as {
        fingerprint: ConfigFingerprint;
        fingerprint_key: string;
      },
    }));

  it("has records to check", () => {
    expect(records.length).toBeGreaterThan(0);
  });

  it.each(records)("$name still keys to its stored fingerprint", ({ record }) => {
    expect(fingerprintKey(record.fingerprint)).toBe(record.fingerprint_key);
  });
});
