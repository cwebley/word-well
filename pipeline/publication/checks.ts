import type pg from "pg";
import { z } from "zod";
import { PrivateError } from "../storage/crypto.js";
import { PUBLICATION_CHECKS, type PublicationCandidate } from "./assemble.js";

export const reviewSchema = z.object({ reviewer: z.string().min(1).refine(value => Boolean(value.trim())),
  decision: z.enum(["approve", "reject"]), findings: z.array(z.string().min(1)),
  candidateId: z.string(), evidenceIdentity: z.string(), attributionIdentity: z.string(), checksIdentity: z.string(),
  pronunciationConfirmed: z.boolean(), reviewedAt: z.iso.datetime()
}).strict();
export type PublicationReview = z.infer<typeof reviewSchema>;

export function checkReview(candidate: PublicationCandidate, review: PublicationReview, requiredChecks: string) {
  if (candidate.checksIdentity !== requiredChecks || requiredChecks !== PUBLICATION_CHECKS || review.checksIdentity !== requiredChecks ||
      review.candidateId !== candidate.id || review.evidenceIdentity !== candidate.evidenceIdentity || review.attributionIdentity !== candidate.attributionIdentity)
    throw new PrivateError("publication_approval_stale");
  if (review.decision !== "approve" || review.findings.length) throw new PrivateError("publication_not_approved");
  if (candidate.blockers.length) throw new PrivateError("publication_candidate_blocked");
  if (candidate.material.pronunciation?.region === "unlabelled" && !review.pronunciationConfirmed)
    throw new PrivateError("publication_pronunciation_unconfirmed");
}

// The adapter must read current intake, gates, selected dependencies and promoted
// configurations through this transaction client. It must not make model calls.
// There is deliberately no permissive default or live command until that adapter
// is implemented against the production coordinator's durable evidence.
export type PublicationAuthorization = (client: pg.PoolClient, candidate: PublicationCandidate) => Promise<{
  intakeAssessmentId: string; appropriatenessResultId: string; usefulnessResultId: string;
  plannerResultId: string; writerResultId: string; plannerPromotionId: string; writerPromotionId: string;
}>;

export async function checkAuthorization(client: pg.PoolClient, candidate: PublicationCandidate, authorize: PublicationAuthorization) {
  const authorization = await authorize(client, candidate);
  // SourceStore.assess fingerprints bundle, candidate and intake configuration.
  // Assessment identities are SHA-256 hashes; result and promotion identities are UUIDs.
  const ids = [authorization.appropriatenessResultId, authorization.usefulnessResultId,
    authorization.plannerResultId, authorization.writerResultId, authorization.plannerPromotionId, authorization.writerPromotionId];
  if (!z.string().regex(/^[a-f0-9]{64}$/).safeParse(authorization.intakeAssessmentId).success ||
      ids.some(id => !z.uuid().safeParse(id).success) || authorization.plannerResultId !== candidate.material.plannerResultId ||
    authorization.writerResultId !== candidate.material.writerResultId) throw new PrivateError("publication_dependencies_changed");
  return authorization;
}
