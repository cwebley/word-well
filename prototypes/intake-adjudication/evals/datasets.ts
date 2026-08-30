import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import type { Claim } from "../src/morphology/claim.ts";
import { candidateSourceMeaningIds, readClaims } from "../src/morphology/claim.ts";
import type { EvidenceManifest } from "../src/fingerprint.ts";
import { readManifest } from "../src/fingerprint.ts";
import type { ExpectedLabel } from "./types.ts";
import { readLabels } from "./types.ts";

const normalDatasetSchema = z.enum(["contract-test", "prompt-smoke", "development", "regression"]);
export type NormalDataset = z.infer<typeof normalDatasetSchema>;

const partitionFileSchema = z.object({
  partition_version: z.string(),
  members: z.array(
    z.object({
      claim_id: z.string(),
      input_digest: z.string(),
      partition: z.enum(["development", "regression", "hidden_holdout"]),
    }),
  ),
});

const smokeFileSchema = z.object({ claim_ids: z.array(z.string()).length(12) });

export interface EvalCase {
  claim: Claim;
  expected: ExpectedLabel;
}

export interface LoadedDataset {
  name: NormalDataset;
  manifest: EvidenceManifest;
  cases: EvalCase[];
}

export function loadReviewClaims(root = process.cwd()): {
  claims: Claim[];
  manifest: EvidenceManifest;
  members: z.infer<typeof partitionFileSchema>["members"];
} {
  const claims = readClaims(join(root, "evidence/calibration-silver.claims.jsonl"));
  const claimsById = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const partitions = partitionFileSchema.parse(
    JSON.parse(readFileSync(join(root, "cases/calibration-v1.partitions.json"), "utf8")),
  );
  if (partitions.members.length !== 12) throw new Error("calibration review must contain 12 claims");
  const selected = partitions.members.map((member) => {
    const claim = claimsById.get(member.claim_id);
    if (!claim) throw new Error(`no evidence for ${member.claim_id}`);
    if (claim.input_digest !== member.input_digest) {
      throw new Error(`input digest mismatch for ${member.claim_id}`);
    }
    return claim;
  });
  return {
    claims: selected,
    manifest: readManifest(join(root, "evidence/calibration-silver.manifest.json")),
    members: partitions.members,
  };
}

function assertLabelMatchesClaim(
  label: ExpectedLabel,
  claim: Claim,
  partition?: "development" | "regression",
): void {
  if (label.label_status === "provisional-unvalidated") {
    throw new Error(`${label.claim_id} is still provisional`);
  }
  if (label.input_digest !== undefined && label.input_digest !== claim.input_digest) {
    throw new Error(`input digest mismatch for ${label.claim_id}`);
  }
  if (partition !== undefined && label.partition !== partition) {
    throw new Error(`${label.claim_id} label is not in the ${partition} partition`);
  }
  const expectedMeaningIds = candidateSourceMeaningIds(claim).sort();
  const labelledMeaningIds = label.meanings.map((meaning) => meaning.sense_id).sort();
  if (
    labelledMeaningIds.length !== new Set(labelledMeaningIds).size ||
    JSON.stringify(labelledMeaningIds) !== JSON.stringify(expectedMeaningIds)
  ) {
    throw new Error(`source meanings do not match evidence for ${label.claim_id}`);
  }
}

export function loadDataset(nameInput: string, root = process.cwd()): LoadedDataset {
  const parsed = normalDatasetSchema.safeParse(nameInput);
  if (!parsed.success) {
    throw new Error(
      `normal development dataset must be contract-test, prompt-smoke, development, or regression`,
    );
  }
  const name = parsed.data;
  if (name === "contract-test") {
    const claims = readClaims(join(root, "evidence/contract-test.claims.jsonl"));
    const labels = readLabels(join(root, "labels/contract-test.labels.jsonl"));
    const cases = claims.map((claim) => {
      const expected = labels.get(claim.claim_id);
      if (!expected) throw new Error(`no label for ${claim.claim_id}`);
      assertLabelMatchesClaim(expected, claim);
      return { claim, expected };
    });
    return {
      name,
      manifest: readManifest(join(root, "evidence/contract-test.manifest.json")),
      cases,
    };
  }

  const claims = readClaims(join(root, "evidence/calibration-silver.claims.jsonl"));
  const claimsById = new Map(claims.map((claim) => [claim.claim_id, claim]));
  const partitions = partitionFileSchema.parse(
    JSON.parse(readFileSync(join(root, "cases/calibration-v1.partitions.json"), "utf8")),
  );
  const partition = name === "regression" ? "regression" : "development";
  let selectedMembers = partitions.members.filter((member) => member.partition === partition);
  if (name === "prompt-smoke") {
    const smoke = smokeFileSchema.parse(
      JSON.parse(readFileSync(join(root, "cases/prompt-smoke.claim-ids.json"), "utf8")),
    );
    const visibleMembers = new Map(
      partitions.members
        .filter((member) => member.partition !== "hidden_holdout")
        .map((member) => [member.claim_id, member]),
    );
    if (smoke.claim_ids.some((claimId) => !visibleMembers.has(claimId))) {
      throw new Error("prompt smoke contains a hidden or unknown claim");
    }
    selectedMembers = smoke.claim_ids.map((claimId) => visibleMembers.get(claimId)!);
  }

  // Normal commands select a partition-specific file. They never open, parse,
  // or infer the path to labels/hidden/holdout.labels.jsonl.
  const labelPartitions: ("development" | "regression")[] = name === "prompt-smoke"
    ? [
        ...new Set(
          selectedMembers.map((member) => {
            if (member.partition === "hidden_holdout") {
              throw new Error("normal loader reached hidden holdout");
            }
            return member.partition;
          }),
        ),
      ]
    : [partition];
  const labels = new Map<string, ExpectedLabel>();
  for (const labelPartition of labelPartitions) {
    for (const [claimId, label] of readLabels(
      join(root, `labels/calibration-v1.${labelPartition}.labels.jsonl`),
    )) {
      if (labels.has(claimId)) throw new Error(`duplicate calibration label ${claimId}`);
      if (label.partition !== labelPartition) {
        throw new Error(`${claimId} label is not in the ${labelPartition} partition`);
      }
      labels.set(claimId, label);
    }
  }
  const memberIds = selectedMembers.map((member) => member.claim_id);
  const memberSet = new Set(memberIds);
  const cases = selectedMembers.map((member) => {
    const claimId = member.claim_id;
    const claim = claimsById.get(claimId);
    if (!claim) throw new Error(`no evidence for ${claimId}`);
    const expected = labels.get(claimId);
    if (!expected) throw new Error(`no validated label for ${claimId}`);
    if (member.partition === "hidden_holdout") throw new Error("normal loader reached hidden holdout");
    assertLabelMatchesClaim(expected, claim, member.partition);
    return { claim, expected };
  });
  for (const claimId of labels.keys()) {
    const isFullPartition = name === "development" || name === "regression";
    if (isFullPartition && !memberSet.has(claimId)) {
      throw new Error(`label ${claimId} is not a frozen ${partition} member`);
    }
  }
  return {
    name,
    manifest: readManifest(join(root, "evidence/calibration-silver.manifest.json")),
    cases,
  };
}
