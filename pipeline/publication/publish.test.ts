// @vitest-environment node
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { writerMeaningEvidence } from "../stages/writer.js";
import { createPublisher } from "./publish.js";
import { type PublicationMaterial } from "./assemble.js";
import { publicationFixture, publicationApproval } from "../testing/publication-fixtures.js";
import { testDatabase, fixturePool, harmlessKeys } from "../testing/private-fixtures.js";
import { PrivateError } from "../storage/crypto.js";

// This policy table exists only in a disposable test database. It exercises
// transaction-bound authorization; it is not the live production adapter.
async function harness() {
  const database = await testDatabase(), keys = await harmlessKeys();
  const admin = fixturePool(database.adminUrl), learner = fixturePool(database.learnerUrl);
  const material = publicationFixture();
  await admin.query(`CREATE TABLE private.fixture_publication_policy (
    candidate_id uuid PRIMARY KEY, planner_id uuid NOT NULL, writer_id uuid NOT NULL,
    intake_accepted boolean NOT NULL, gates_accepted boolean NOT NULL, promoted boolean NOT NULL,
    assessment_id text NOT NULL, appropriateness_id uuid NOT NULL, usefulness_id uuid NOT NULL,
    planner_promotion_id uuid NOT NULL, writer_promotion_id uuid NOT NULL)`);
  await admin.query("INSERT INTO private.fixture_publication_policy VALUES($1,$2,$3,true,true,true,$4,$5,$6,$7,$8)",
    [material.candidateId, material.plannerResultId, material.writerResultId, "a".repeat(64), randomUUID(), randomUUID(), randomUUID(), randomUUID()]);
  let failProjection = false;
  const options = { connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto,
    authorize: async (client: import("pg").PoolClient, candidate: import("./assemble.js").PublicationCandidate) => {
      const { rows: [policy] } = await client.query("SELECT * FROM private.fixture_publication_policy WHERE candidate_id=$1", [candidate.material.candidateId]);
      if (!policy?.intake_accepted || !policy.gates_accepted) throw new PrivateError("fixture_current_permission_rejected");
      if (!policy.promoted) throw new PrivateError("fixture_promotion_missing");
      return { intakeAssessmentId: policy.assessment_id, appropriatenessResultId: policy.appropriateness_id, usefulnessResultId: policy.usefulness_id,
        plannerResultId: policy.planner_id, writerResultId: policy.writer_id, plannerPromotionId: policy.planner_promotion_id, writerPromotionId: policy.writer_promotion_id };
    }, beforeWrite: async (operation: "revision" | "projection" | "after-projection") => { if (operation === "after-projection" && failProjection) throw new Error("fixture-write-failure"); } };
  const publisher = createPublisher(options);
  const approve = async (value: PublicationMaterial = material) => {
    const candidate = await publisher.assembleCandidate(value);
    await publisher.recordReview(publicationApproval(candidate));
    return candidate;
  };
  const publicRecord = async () => (await learner.query("SELECT * FROM public.published_lessons WHERE id=$1", [material.lessonId])).rows[0];
  const seedPractice = async (itemId = "fixture-practice") => {
    const meaning = (await publicRecord()).record.meanings[0];
    const record = { schemaVersion: "wordwell-practice-v1", itemId, publicationVersion: 1, lessonId: material.lessonId,
      meaningId: meaning.id, definition: meaning.definition, partOfSpeech: meaning.partOfSpeech, prompt: "Fixture?",
      correctSentence: "A fixture.", incorrectSentence: "Not a fixture.", explanation: "Synthetic check." };
    await admin.query("INSERT INTO public.published_practice_items(item_id,publication_version,lesson_id,record) VALUES($1,1,$2,$3)", [record.itemId, material.lessonId, record]);
  };
  const availablePractice = async (itemId = "fixture-practice") => (await learner.query("SELECT available FROM public.published_practice_items WHERE item_id=$1", [itemId])).rows[0]?.available;
  return { database, keys, admin, learner, material, publisher, options, approve, publicRecord, seedPractice, availablePractice,
    setFailure: (value: boolean) => { failProjection = value; },
    close: async () => { await Promise.all([publisher.close(), admin.end(), learner.end()]); await database.drop(); } };
}

describe.skipIf(!process.env.DATABASE_URL)("restricted fixture publication transactions", () => {
  it("publishes saved candidates atomically, retains encrypted history and retries without reactivating withdrawn content", async () => {
    const h = await harness();
    try {
      const candidate = await h.approve();
      expect(await h.publisher.getReviewCandidate(candidate.id)).toEqual(candidate);
      expect(await h.publisher.publishCandidate(candidate.id, 0)).toEqual({ publicationVersion: 1, reused: false });
      expect((await h.publicRecord()).record).toMatchObject({ publicationVersion: 1, meanings: [{ definition: "A thing used in a check." }] });
      await h.admin.query("UPDATE public.published_lessons SET available=false WHERE id=$1", [h.material.lessonId]);
      expect(await h.publisher.publishCandidate(candidate.id, 0)).toEqual({ publicationVersion: 1, reused: true });
      expect((await h.publicRecord()).available).toBe(false);
      const revisions = await h.admin.query("SELECT * FROM private.publication_revisions");
      expect(revisions.rows).toHaveLength(1);
      expect(revisions.rows[0].payload.toString()).not.toContain("fixture-owner");
      for (const table of ["publication_candidates", "publication_reviews", "publication_revisions"])
        await expect(h.learner.query(`SELECT * FROM private.${table}`)).rejects.toMatchObject({ code: "42501" });
      const pipeline = fixturePool(h.database.pipelineUrl);
      try {
        await expect(pipeline.query("DELETE FROM public.published_lessons")).rejects.toMatchObject({ code: "42501" });
        await expect(pipeline.query("UPDATE private.publication_revisions SET publication_version=9")).rejects.toMatchObject({ code: "42501" });
        await expect(pipeline.query("UPDATE public.published_lessons SET id='changed'")).rejects.toMatchObject({ code: "42501" });
      } finally { await pipeline.end(); }
    } finally { await h.close(); }
  }, 30000);
  it("retains hash-based intake assessment identities from the production source store", async () => {
    const h = await harness();
    try {
      const assessmentId = "d".repeat(64);
      await h.admin.query("UPDATE private.fixture_publication_policy SET assessment_id=$1", [assessmentId]);
      const candidate = await h.approve();
      expect(await h.publisher.publishCandidate(candidate.id, 0)).toEqual({ publicationVersion: 1, reused: false });
      const { rows: [row] } = await h.admin.query("SELECT * FROM private.publication_revisions WHERE candidate_id=$1", [candidate.id]);
      const revision = await h.keys.crypto.decrypt(h.keys.storageKey, `publication_revisions:${candidate.id}:payload`, row.payload,
        z.object({ authorization: z.object({ intakeAssessmentId: z.string() }).passthrough() }).passthrough());
      expect(revision.authorization.intakeAssessmentId).toBe(assessmentId);
    } finally { await h.close(); }
  }, 30000);
  it.each(["", randomUUID(), "g".repeat(64), "a".repeat(63)])("rejects malformed intake assessment identity %j before publication writes", async assessmentId => {
    const h = await harness();
    try {
      await h.admin.query("UPDATE private.fixture_publication_policy SET assessment_id=$1", [assessmentId]);
      const candidate = await h.approve();
      await expect(h.publisher.publishCandidate(candidate.id, 0)).rejects.toThrow("publication_dependencies_changed");
      expect(await h.publicRecord()).toBeUndefined();
      expect((await h.admin.query("SELECT * FROM private.publication_revisions")).rows).toHaveLength(0);
      expect(await h.publisher.getReviewCandidate(candidate.id)).toEqual(candidate);
    } finally { await h.close(); }
  }, 30000);
  it("rolls back revision, public replacement and Practice retirement together, leaving reviews intact", async () => {
    const h = await harness();
    try {
      const first = await h.approve(); await h.publisher.publishCandidate(first.id, 0); await h.seedPractice();
      const before = await h.publicRecord();
      const replacement = structuredClone(h.material);
      replacement.input.plan.meanings[0].definition = replacement.input.meanings[0].definition = "A revised fixture definition.";
      const second = await h.approve(replacement);
      h.setFailure(true);
      await expect(h.publisher.publishCandidate(second.id, 1)).rejects.toThrow("publication_storage_unavailable");
      expect(await h.publicRecord()).toEqual(before);
      expect(await h.availablePractice()).toBe(true);
      expect((await h.admin.query("SELECT * FROM private.publication_revisions")).rows).toHaveLength(1);
      expect((await h.admin.query("SELECT * FROM private.publication_reviews")).rows).toHaveLength(2);
      h.setFailure(false);
      await h.publisher.publishCandidate(second.id, 1);
      expect(await h.availablePractice()).toBe(false);
      const after = await h.publicRecord();
      expect(after.record.meanings[0].id).toBe(before.record.meanings[0].id);
      expect(after.record.publicationVersion).toBe(2);
      const example = structuredClone(replacement); example.written.meanings[0].examples[2] = "They replaced the fixture example.";
      await h.publisher.publishCandidate((await h.approve(example)).id, 2);
      expect(await h.availablePractice()).toBe(false); // No automatic revival.
    } finally { await h.close(); }
  }, 30000);
  it("retains Practice on example-only edits and rejects failed replacement authorization without changing content", async () => {
    const h = await harness();
    try {
      await h.publisher.publishCandidate((await h.approve()).id, 0); await h.seedPractice();
      const edited = structuredClone(h.material); edited.written.meanings[0].examples[2] = "They replaced the fixture example.";
      const candidate = await h.approve(edited), before = await h.publicRecord();
      await h.admin.query("UPDATE private.fixture_publication_policy SET gates_accepted=false");
      await expect(h.publisher.publishCandidate(candidate.id, 1)).rejects.toThrow("fixture_current_permission_rejected");
      expect(await h.publicRecord()).toEqual(before);
      await h.admin.query("UPDATE private.fixture_publication_policy SET gates_accepted=true,appropriateness_id=$1,usefulness_id=$2", [randomUUID(), randomUUID()]);
      await h.publisher.publishCandidate(candidate.id, 1);
      expect(await h.availablePractice()).toBe(true);
      expect((await h.publicRecord()).record.meanings[0].id).toBe(before.record.meanings[0].id);
      expect((await h.publisher.getReviewCandidate(candidate.id)).material).toEqual(candidate.material);
    } finally { await h.close(); }
  }, 30000);
  it("blocks absent/rejected/stale approvals, promotion failures, dependency changes and live artifacts", async () => {
    const h = await harness();
    try {
      const candidate = await h.publisher.assembleCandidate(h.material);
      await expect(h.publisher.publishCandidate(candidate.id, 0)).rejects.toThrow("publication_not_approved");
      await h.publisher.recordReview(publicationApproval(candidate, { decision: "reject", findings: ["Controlled rejection"] }));
      await expect(h.publisher.publishCandidate(candidate.id, 0)).rejects.toThrow("publication_not_approved");
      await expect(h.publisher.recordReview(publicationApproval(candidate, { evidenceIdentity: "changed" }))).rejects.toThrow("publication_approval_stale");
      await h.publisher.recordReview(publicationApproval(candidate));
      const stricter = createPublisher({ ...h.options, requiredChecks: "future-checks" });
      try { await expect(stricter.publishCandidate(candidate.id, 0)).rejects.toThrow("publication_approval_stale"); }
      finally { await stricter.close(); }
      await h.admin.query("UPDATE private.fixture_publication_policy SET promoted=false");
      await expect(h.publisher.publishCandidate(candidate.id, 0)).rejects.toThrow("fixture_promotion_missing");
      await h.admin.query("UPDATE private.fixture_publication_policy SET promoted=true,writer_id=$1", [randomUUID()]);
      await expect(h.publisher.publishCandidate(candidate.id, 0)).rejects.toThrow("publication_dependencies_changed");
      const live = await h.approve({ ...h.material, executionKind: "live" });
      await expect(h.publisher.publishCandidate(live.id, 0)).rejects.toThrow("publication_live_authorization_unimplemented");
      expect(await h.publicRecord()).toBeUndefined();
    } finally { await h.close(); }
  }, 30000);
  it("persists split/merge predecessors, preserves reordered identities and retires Practice on split and POS change", async () => {
    const h = await harness();
    try {
      const grouped = (groups: string[][]) => {
        const material = structuredClone(h.material);
        material.input.plan.meanings = groups.map((refs, index) => ({ definition: `Controlled meaning ${index + 1}.`,
          part_of_speech: "noun", sense_ids: refs, usage_note_sense_ids: [], synonyms: index === 0 ? ["example"] : [] }));
        material.input.meanings = material.input.plan.meanings.map((plan, index) => ({ ...structuredClone(h.material.input.meanings[0]),
          ref: `m${index + 1}`, definition: plan.definition, synonyms: plan.synonyms,
          contrastDefinitions: index === 0 ? h.material.input.meanings[0].contrastDefinitions : [],
          ...writerMeaningEvidence(material.input.plannerInput, plan) }));
        material.written.meanings = material.input.meanings.map((meaning, index) => ({ ...structuredClone(h.material.written.meanings[0]),
          meaning_id: meaning.ref, synonyms: index === 0 ? h.material.written.meanings[0].synonyms : [], usage_notes: [] }));
        return material;
      };
      await h.publisher.publishCandidate((await h.approve()).id, 0);
      const originalId = (await h.publicRecord()).record.meanings[0].id;
      const merged = await h.approve(grouped([["s1", "s2"]]));
      await h.publisher.publishCandidate(merged.id, 1);
      const mergedId = (await h.publicRecord()).record.meanings[0].id;
      expect(mergedId).not.toBe(originalId);
      const revision = async (id: string) => {
        const { rows: [row] } = await h.admin.query("SELECT * FROM private.publication_revisions WHERE candidate_id=$1", [id]);
        return h.keys.crypto.decrypt(h.keys.storageKey, `publication_revisions:${id}:payload`, row.payload,
          z.object({ meanings: z.array(z.object({ id: z.string(), predecessors: z.array(z.string()) })) }));
      };
      expect((await revision(merged.id)).meanings[0].predecessors).toEqual([originalId]);
      await h.seedPractice();
      const splitMaterial = grouped([["s1"], ["s2"]]);
      const split = await h.approve(splitMaterial); await h.publisher.publishCandidate(split.id, 2);
      const splitIds = (await h.publicRecord()).record.meanings.map((meaning: { id: string }) => meaning.id);
      expect((await revision(split.id)).meanings.map(meaning => meaning.predecessors)).toEqual([[mergedId], [mergedId]]);
      expect(await h.availablePractice()).toBe(false);
      const reordered = structuredClone(splitMaterial);
      reordered.input.plan.meanings.reverse(); reordered.input.meanings.reverse(); reordered.written.meanings.reverse();
      reordered.input.meanings.forEach((meaning, index) => { meaning.ref = `m${index + 1}`; });
      reordered.written.meanings.forEach((meaning, index) => { meaning.meaning_id = `m${index + 1}`; });
      await h.publisher.publishCandidate((await h.approve(reordered)).id, 3);
      expect((await h.publicRecord()).record.meanings.map((meaning: { id: string }) => meaning.id)).toEqual([...splitIds].reverse());
      await h.seedPractice("pos-practice");
      const changedPOS = structuredClone(reordered);
      changedPOS.input.plannerInput.meanings.forEach(meaning => { meaning.partOfSpeech = "verb"; meaning.recordedPos = "v"; });
      changedPOS.input.plan.meanings.forEach(meaning => { meaning.part_of_speech = "verb"; });
      changedPOS.input.meanings.forEach(meaning => { meaning.partOfSpeech = "verb"; });
      await h.publisher.publishCandidate((await h.approve(changedPOS)).id, 4);
      expect(await h.availablePractice("pos-practice")).toBe(false);
    } finally { await h.close(); }
  }, 30000);
  it("serializes overlapping publication, deduplicates same-candidate retry and rejects competing expected versions", async () => {
    const h = await harness(), other = createPublisher(h.options);
    try {
      const first = await h.approve();
      const same = await Promise.all([h.publisher.publishCandidate(first.id, 0), other.publishCandidate(first.id, 0)]);
      expect(same.map(value => value.reused).sort()).toEqual([false, true]);
      const one = structuredClone(h.material); one.written.meanings[0].examples[1] = "One fixture replacement.";
      const two = structuredClone(h.material); two.written.meanings[0].examples[1] = "Another fixture replacement.";
      const a = await h.approve(one), b = await h.approve(two);
      const conflict = await Promise.allSettled([h.publisher.publishCandidate(a.id, 1), other.publishCandidate(b.id, 1)]);
      expect(conflict.filter(value => value.status === "fulfilled")).toHaveLength(1);
      const rejected = conflict.find(value => value.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason.message).toBe("publication_version_conflict");
      expect((await h.admin.query("SELECT * FROM private.publication_revisions")).rows).toHaveLength(2);
      expect((await h.publicRecord()).record.publicationVersion).toBe(2);
    } finally { await other.close(); await h.close(); }
  }, 30000);
});
