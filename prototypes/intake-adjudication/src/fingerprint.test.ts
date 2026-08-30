import { describe, expect, it } from "vitest";

import { buildFingerprint, canonicalJson, fingerprintKey, readManifest } from "./fingerprint.ts";
import type { EvidenceManifest, ModelConfig } from "./fingerprint.ts";

const manifest: EvidenceManifest = readManifest("evidence/contract-test.manifest.json");
const model: ModelConfig = {
  provider: "openrouter",
  model: "test/model",
  upstreamProvider: "test-provider",
  temperature: 0,
  seed: null,
};

const key = (m: EvidenceManifest = manifest, c: ModelConfig = model, digest = "abc") =>
  fingerprintKey(buildFingerprint(digest, m, c));

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
