// The config fingerprint: the identifier for one reproducible adjudication.
//
// Prompt version alone is not a safe cache key. A source, parser, rule, model,
// rubric or contract change can alter the valid answer while the prompt text
// stays byte-identical, so every one of those is a field here. Two runs that
// share a fingerprint are the same question asked the same way; a run that does
// not match any stored fingerprint has to be paid for again.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { CONTRACT_VERSION } from "./contract.ts";
import { POLICY_VERSION } from "./policy.ts";
import { PROMPT_VERSION, RUBRIC_VERSION } from "./prompt.ts";

export interface EvidenceManifest {
  case_set: string;
  extraction_version: string;
  sources: {
    oewn: { release: string; retrieved_via: string };
    wordfreq: { version: string; wordlist: string };
    candidate_pool: { path: string; sha256: string };
  };
  deterministic_rules: { source: string; sha256: string | null };
  claims: Record<string, string>;
}

export interface ModelConfig {
  provider: string;
  model: string;
  /** OpenRouter upstream provider. Always pinned: routing is not a hidden variable. */
  upstreamProvider: string;
  temperature: number;
  seed: number | null;
}

export interface ConfigFingerprint {
  input_digest: string;
  sources: EvidenceManifest["sources"];
  extraction_version: string;
  deterministic_rules_sha256: string | null;
  provider: string;
  model: string;
  upstream_provider: string;
  temperature: number;
  seed: number | null;
  prompt_version: string;
  rubric_version: string;
  contract_version: string;
  policy_version: string;
}

export function readManifest(path: string): EvidenceManifest {
  return JSON.parse(readFileSync(path, "utf-8")) as EvidenceManifest;
}

export function buildFingerprint(
  inputDigest: string,
  manifest: EvidenceManifest,
  model: ModelConfig,
): ConfigFingerprint {
  return {
    input_digest: inputDigest,
    sources: manifest.sources,
    extraction_version: manifest.extraction_version,
    deterministic_rules_sha256: manifest.deterministic_rules.sha256,
    provider: model.provider,
    model: model.model,
    upstream_provider: model.upstreamProvider,
    temperature: model.temperature,
    seed: model.seed,
    prompt_version: PROMPT_VERSION,
    rubric_version: RUBRIC_VERSION,
    contract_version: CONTRACT_VERSION,
    policy_version: POLICY_VERSION,
  };
}

/** Stable hash of a fingerprint. Key ordering must not change the result. */
export function fingerprintKey(fingerprint: ConfigFingerprint): string {
  return createHash("sha256").update(canonicalJson(fingerprint)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
