import { z } from "zod";
import { readFile } from "node:fs/promises";
import { fingerprint } from "./config.js";
import { PrivateError } from "./storage/crypto.js";

export const GATE_COMPATIBILITY_POLICY = {
  schema: "wordwell-gate-compatibility-policy-v1",
  decisionReference: "https://github.com/cwebley/word-well/issues/34#issuecomment-6069716932",
  originalRule: "c1c53e7f137fe21bed9d6b4c537303d00f6c2ec7b51508244b8e69a386066b37",
  currentRule: "3fdac0db3fdcfb654c32f04344b3913fcf1550af6d68597dbe9f969427546fee",
  historicalProjection: "omit-only-empty-request-verifications",
  gateTransition: "type-only-model-interface-to-stage-specific-identity",
  originalEvaluationImplementation: "1266db030c7ca52515a000b1d5b9b65ad1b4c8c63dc4286fedd87aa78585d0b2",
  historicalProductionImplementations: [
    "2871109493cddcfdf1f462b14e4b707b884c6019a2af730b67747033c2f164fb",
    "56c05f223924b3a3a461b07da8dd5349feb4b982b8a02d4538e1fa5041a1a06a",
    "41ccc7fdbf81895f82cc6a8a0663eed0c5c50dad9201e12b96af1066b8254b02"
  ],
  modelCalls: 0
} as const;
// Bind each proof to the checker that issued and consumes it. Shared model
// types are deliberately absent; the pinned historical text is included.
const policyImplementation = await Promise.all(["./gate-compatibility.ts", "./gate-promotion-compatibility.ts", "./reuse.ts", "./run.ts",
  "./config.ts", "./execution/executor.ts", "./execution/system-one.ts", "./execution/validation-only.ts", "./storage/postgres.ts", "./storage/crypto.ts", "./compatibility/model-before-luna.txt", "../db/private-migrations/014_gate_compatibilities.sql"]
  .map(async path => ({ path, bytes: await readFile(new URL(path, import.meta.url), "utf8") })));
export const gateCompatibilityPolicyIdentity = () => fingerprint({ policy: GATE_COMPATIBILITY_POLICY, implementation: policyImplementation });
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const base = z.object({ schema: z.literal("wordwell-gate-compatibility-v1"), id: sha, subjectId: z.uuid(),
  originalIdentity: sha, currentIdentity: sha, evidenceIdentity: sha, policyIdentity: sha, modelCalls: z.literal(0) });
export const gateCompatibilitySchema = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("promotion"), originalAssessmentId: sha, currentAssessmentId: sha, retainedEvidenceIdentity: sha }).strict(),
  base.extend({ kind: z.enum(["appropriateness", "usefulness"]) }).strict()
]);
export type GateCompatibility = z.infer<typeof gateCompatibilitySchema>;
export type GateCompatibilityKey = Pick<GateCompatibility, "kind" | "subjectId" | "currentIdentity" | "policyIdentity">;
export function parseGateCompatibility(value: unknown) {
  const parsed = gateCompatibilitySchema.safeParse(value);
  if (!parsed.success) throw new PrivateError("gate_compatibility_invalid");
  const { id, ...material } = parsed.data;
  if (fingerprint(material) !== id || material.policyIdentity !== gateCompatibilityPolicyIdentity()) throw new PrivateError("gate_compatibility_invalid");
  return parsed.data;
}
