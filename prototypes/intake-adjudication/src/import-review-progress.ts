import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { readClaims } from "./claim.ts";
import { analysisSupportValues, predictabilityValues } from "./contract.ts";
import { applyEndorsement, deriveMorphologyDisposition } from "./policy.ts";
import { RUBRIC_VERSION } from "./prompt.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const progressSchema = z.object({
  format: z.literal("wordwell-review-progress/1"),
  partition_version: z.literal("morphology-calibration/2"),
  reviews: z.array(
    z.object({
      claim_id: z.string(),
      input_digest: z.string(),
      analysis_support: z.enum(analysisSupportValues),
      meanings: z.record(z.string(), z.enum(predictabilityValues)),
      note: z.string(),
      review_decision: z.string(),
      validated_at: z.string().nullable(),
    }),
  ),
});

const partitionSchema = z.object({
  partition_version: z.literal("morphology-calibration/2"),
  members: z.array(
    z.object({
      claim_id: z.string(),
      input_digest: z.string(),
      partition: z.literal("development"),
      primary_slice: z.string(),
    }),
  ),
});

function main(): void {
  const input = resolve(process.argv[2] ?? resolve(root, "../../morphology-calibration.progress.json"));
  const progress = progressSchema.parse(JSON.parse(readFileSync(input, "utf8")));
  const partitions = partitionSchema.parse(
    JSON.parse(readFileSync(resolve(root, "cases/calibration-v1.partitions.json"), "utf8")),
  );
  const claims = new Map(
    readClaims(resolve(root, "evidence/calibration-silver.claims.jsonl")).map((claim) => [
      claim.claim_id,
      claim,
    ]),
  );
  const reviews = new Map(progress.reviews.map((review) => [review.claim_id, review]));
  if (reviews.size !== 12 || partitions.members.length !== 12) {
    throw new Error("the submitted review and frozen dataset must each contain exactly 12 cases");
  }

  const importedAt = new Date().toISOString();
  const labels = partitions.members.map((member) => {
    const claim = claims.get(member.claim_id);
    const review = reviews.get(member.claim_id);
    if (!claim || !review) throw new Error(`missing submitted review for ${member.claim_id}`);
    if (review.input_digest !== claim.input_digest || member.input_digest !== claim.input_digest) {
      throw new Error(`input digest mismatch for ${member.claim_id}`);
    }
    const candidateIds = claim.candidate.source_meanings.map((meaning) => meaning.sense_id).sort();
    const reviewedIds = Object.keys(review.meanings).sort();
    if (JSON.stringify(candidateIds) !== JSON.stringify(reviewedIds)) {
      throw new Error(`source meanings do not match for ${member.claim_id}`);
    }
    const predictabilities = claim.candidate.source_meanings.map(
      (meaning) => review.meanings[meaning.sense_id]!,
    );
    const morphology = deriveMorphologyDisposition({
      analysisSupport: review.analysis_support,
      predictabilities,
    });
    const effective = applyEndorsement(morphology, claim.policy_context.endorsements);
    return {
      analysis_support: review.analysis_support,
      claim_id: claim.claim_id,
      effective_disposition: effective.disposition,
      endorsement_override: effective.endorsementOverride,
      endorsements: claim.policy_context.endorsements,
      input_digest: claim.input_digest,
      label_status: "human-validated",
      meanings: claim.candidate.source_meanings.map((meaning) => ({
        predictability: review.meanings[meaning.sense_id]!,
        sense_id: meaning.sense_id,
      })),
      morphology_disposition: morphology.disposition,
      note: review.note,
      partition: member.partition,
      review_decision: review.review_decision === "accepted" ? "accepted" : "corrected",
      rubric_version: RUBRIC_VERSION,
      slice: member.primary_slice,
      validated_at: review.validated_at ?? importedAt,
    };
  });
  labels.sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  const output = resolve(root, "labels/calibration-v1.development.labels.jsonl");
  writeFileSync(output, `${labels.map((label) => JSON.stringify(label)).join("\n")}\n`);
  console.log(`imported ${labels.length} human-reviewed labels to ${output}`);
}

main();
