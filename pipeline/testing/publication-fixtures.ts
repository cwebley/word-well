import { randomUUID } from "node:crypto";
import { writerFixture, writtenFixture } from "./writer-fixtures.js";
import type { PublicationMaterial, PublicationCandidate } from "../publication/assemble.js";
import type { PublicationReview } from "../publication/checks.js";

// Invented evidence and attribution. Not a production source import or approval.
export function publicationFixture(): PublicationMaterial {
  return { executionKind: "controlled", candidateId: randomUUID(), lessonId: "fixture-lesson",
    plannerResultId: randomUUID(), writerResultId: randomUUID(), plannerFingerprint: "b".repeat(64), writerFingerprint: "c".repeat(64),
    input: structuredClone(writerFixture), written: structuredClone(writtenFixture),
    sources: [
      { id: "oewn-fixture", kind: "oewn", name: "Synthetic OEWN", release: "fixture-1", url: "https://example.org/oewn",
        license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" }, credits: ["OEWN fixture", "Princeton fixture"], notices: ["Synthetic notice"], changes: "Selected, grouped and adapted for the fixture; additional teaching text generated.", revisionUrl: null, historyUrl: null },
      { id: "wiktionary-fixture", kind: "wiktionary", name: "Synthetic Wiktionary", release: "fixture-1", url: "https://example.org/fixture",
        license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" }, credits: ["Fixture contributors"], notices: ["Synthetic notice"], changes: "Selected source fields.", revisionUrl: "https://example.org/fixture?oldid=1", historyUrl: "https://example.org/fixture?action=history" }
    ], sourceMeanings: {
      s1: { citationId: "oewn-fixture", snapshotId: "oewn-fixture-1", recordId: "private-source-1" },
      s2: { citationId: "oewn-fixture", snapshotId: "oewn-fixture-1", recordId: "private-source-2" }
    }, citationSnapshots: { "oewn-fixture": "oewn-fixture-1", "wiktionary-fixture": "wiktionary-fixture-1" },
    familySupport: { fixtures: [{ locator: { citationId: "wiktionary-fixture", snapshotId: "wiktionary-fixture-1", recordId: "line:1" },
      relation: { source: "kaikki", from: "line:1", to: "fixtures", type: "derived" } }] },
    pronunciation: { text: "/ˈfɪkstʃər/", region: "US", support: { citationId: "wiktionary-fixture", snapshotId: "wiktionary-fixture-1", recordId: "pronunciation-1" } },
    etymology: null, etymologyAbsence: "Controlled absence, not failed acquisition." };
}
export function publicationApproval(candidate: PublicationCandidate, overrides: Partial<PublicationReview> = {}): PublicationReview {
  return { reviewer: "fixture-owner", decision: "approve", findings: [], candidateId: candidate.id,
    evidenceIdentity: candidate.evidenceIdentity, attributionIdentity: candidate.attributionIdentity, checksIdentity: candidate.checksIdentity,
    pronunciationConfirmed: false, reviewedAt: new Date().toISOString(), ...overrides };
}
