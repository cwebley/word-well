import { describe, it, expect } from "vitest";
import { assembleCandidate, publicProjection, PUBLICATION_CHECKS, verifyCandidate } from "./assemble.js";
import { checkReview } from "./checks.js";
import { resolveMeanings } from "./identities.js";
import { publicationFixture, publicationApproval } from "../testing/publication-fixtures.js";

describe("immutable fixture publication candidates", () => {
  it("retains complete evidence and dictionary reuse while projecting only public fields", () => {
    const material = publicationFixture(), candidate = assembleCandidate(material);
    expect(candidate.meanings[0].exampleAssociations[0].directMatches).toEqual([material.sourceMeanings.s1]);
    expect(Object.isFrozen(candidate.material.input.plan.meanings[0])).toBe(true);
    material.written.meanings[0].situation = "Changed outside the candidate";
    expect(candidate.meanings[0].useItWhen).not.toBe(material.written.meanings[0].situation);
    const record = publicProjection(candidate, 1, ["stable-meaning"]);
    expect(record.meanings[0]).toMatchObject({ id: "stable-meaning", definition: "A thing used in a check.", usageNotes: [{ sourceRefs: ["oewn-fixture"] }] });
    expect(record.license.name).toBe("CC BY-SA 4.0");
    expect(JSON.stringify(record)).not.toMatch(/private-source|plannerResultId|definingSources|exampleAssociations/);
    expect(verifyCandidate(candidate)).toEqual(candidate);
    expect(() => verifyCandidate({ ...candidate, id: "forged" })).toThrow("publication_candidate_changed");
  });
  it("requires new identities and review for text, evidence or attribution changes", () => {
    const original = publicationFixture(), candidate = assembleCandidate(original);
    for (const change of [
      (value: typeof original) => { value.written.meanings[0].examples[1] = "Another fixture example."; },
      (value: typeof original) => { value.sourceMeanings.s1.snapshotId = value.sourceMeanings.s2.snapshotId = value.citationSnapshots["oewn-fixture"] = "another-release"; },
      (value: typeof original) => { value.sources[0].notices.push("Another notice"); }
    ]) {
      const material = structuredClone(original); change(material);
      const changed = assembleCandidate(material);
      expect(changed.id).not.toBe(candidate.id);
      expect(() => checkReview(changed, publicationApproval(candidate), PUBLICATION_CHECKS)).toThrow("publication_approval_stale");
    }
    expect(() => checkReview(candidate, publicationApproval(candidate), "new-checks")).toThrow("publication_approval_stale");
  });
  it("keeps missing pronunciation as a blocker and requires unlabelled confirmation", () => {
    const material = publicationFixture(); material.pronunciation = null;
    const missing = assembleCandidate(material);
    expect(missing.blockers).toEqual(["pronunciation_missing"]);
    expect(() => checkReview(missing, publicationApproval(missing), PUBLICATION_CHECKS)).toThrow("publication_candidate_blocked");
    const unlabelled = publicationFixture(); unlabelled.pronunciation!.region = "unlabelled";
    const candidate = assembleCandidate(unlabelled);
    expect(() => checkReview(candidate, publicationApproval(candidate), PUBLICATION_CHECKS)).toThrow("publication_pronunciation_unconfirmed");
    expect(() => checkReview(candidate, publicationApproval(candidate, { pronunciationConfirmed: true }), PUBLICATION_CHECKS)).not.toThrow();
    unlabelled.pronunciation!.region = "other";
    expect(assembleCandidate(unlabelled).blockers).toEqual(["pronunciation_region_unsupported"]);
  });
  it("rejects invalid saved output, missing support and mismatched optional origin", () => {
    const duplicate = publicationFixture(); duplicate.sources.push(structuredClone(duplicate.sources[0]));
    expect(() => assembleCandidate(duplicate)).toThrow("publication_citation_duplicate");
    const invalid = publicationFixture(); invalid.written.meanings = [];
    expect(() => assembleCandidate(invalid)).toThrow("writer_meaning_coverage_invalid");
    const unsupported = publicationFixture(); delete unsupported.familySupport.fixtures;
    expect(() => assembleCandidate(unsupported)).toThrow("publication_family_support_missing");
    const unrelated = publicationFixture(); unrelated.familySupport.fixtures[0].locator = unrelated.sourceMeanings.s1;
    expect(() => assembleCandidate(unrelated)).toThrow("publication_family_relation_invalid");
    const wrongCitation = publicationFixture(); wrongCitation.sources.push({ ...wrongCitation.sources[0], id: "unrelated-oewn" });
    wrongCitation.sourceMeanings.s1.citationId = "unrelated-oewn";
    expect(() => assembleCandidate(wrongCitation)).toThrow("publication_support_missing");
    const origin = publicationFixture(); origin.etymologyAbsence = null;
    expect(() => assembleCandidate(origin)).toThrow("publication_origin_absence_invalid");
    const quotation = publicationFixture(); quotation.input.excludedQuotations = [{ source_ref: "external", text: quotation.written.meanings[0].examples[1] }];
    expect(() => assembleCandidate(quotation)).toThrow("writer_external_quotation");
  });
  it("projects pinned origin text and rejects a mismatched entry or raw source revision", () => {
    const material = publicationFixture();
    material.etymology = { text: "Synthetic fixture origin.", rawSha256: "d".repeat(64),
      support: { citationId: "wiktionary-fixture", snapshotId: "wiktionary-fixture-1", recordId: "origin-entry" } };
    material.etymologyAbsence = null;
    material.input.meanings[0].origin = { text: material.etymology.text, source_ref: "origin-entry", entryId: "origin-entry", rawSha256: material.etymology.rawSha256 };
    material.input.meanings[0].originAbsence = null;
    material.written.meanings[0].origin_note = "This fixture origin helps explain this controlled meaning.";
    const candidate = assembleCandidate(material);
    expect(publicProjection(candidate, 1, ["meaning"]).meanings[0].originNote).toEqual({ text: material.written.meanings[0].origin_note, sourceRefs: ["wiktionary-fixture"] });
    material.etymology.support.recordId = "another-origin";
    expect(() => assembleCandidate(material)).toThrow("publication_origin_support_invalid");
    material.etymology.support.recordId = "origin-entry"; material.etymology.rawSha256 = "e".repeat(64);
    expect(() => assembleCandidate(material)).toThrow("publication_origin_support_invalid");
  });
  it("preserves IDs across wording edits, creates split/merge predecessors, and never infers cross-release correspondence", () => {
    const candidate = assembleCandidate(publicationFixture());
    const old = resolveMeanings(candidate, []);
    const changed = structuredClone(candidate); changed.meanings[0].definition = "Reworded.";
    expect(resolveMeanings(changed, old)[0].id).toBe(old[0].id);
    const merged = structuredClone(candidate); merged.meanings[0].definingSources.push(merged.material.sourceMeanings.s2);
    const mergeRevision = resolveMeanings(merged, old);
    expect(mergeRevision[0].id).not.toBe(old[0].id);
    expect(mergeRevision[0].predecessors).toEqual([old[0].id]);
    const split = structuredClone(merged);
    split.meanings = [structuredClone(candidate.meanings[0]), { ...structuredClone(candidate.meanings[0]), ref: "m2", definingSources: [candidate.material.sourceMeanings.s2] }];
    const splitRevisions = resolveMeanings(split, mergeRevision);
    expect(splitRevisions.map(value => value.predecessors)).toEqual([[mergeRevision[0].id], [mergeRevision[0].id]]);
    expect(resolveMeanings({ ...split, meanings: [...split.meanings].reverse() }, splitRevisions).map(value => value.id)).toEqual(splitRevisions.map(value => value.id).reverse());
    const nextRelease = structuredClone(candidate); nextRelease.meanings[0].definingSources[0].snapshotId = "new-release";
    const unmatched = resolveMeanings(nextRelease, old);
    expect(unmatched[0].id).not.toBe(old[0].id);
    expect(unmatched[0].predecessors).toEqual([]);
  });
});
