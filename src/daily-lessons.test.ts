import { describe, expect, it } from "vitest";
import type { PublishedVocabularyRecord, SourceEvidence } from "./content-pipeline";
import { DailyLessons, type PublishedLesson } from "./daily-lessons";

const evidence: SourceEvidence = {
  id: "source",
  source: "source",
  sourceId: "source-id",
  release: "1",
  retrievedAt: "2026-08-26",
  license: "CC BY 4.0",
  attribution: "Source",
  dialect: "General American",
  originalLabel: "noun",
  uncertainty: "confirmed",
  claims: []
};

function lesson(id: string, headword: string, startingBand: PublishedLesson["startingBand"]): PublishedLesson {
  const record: PublishedVocabularyRecord = {
    headword,
    normalizedHeadword: headword.toLowerCase(),
    version: "1",
    pronunciation: `/${headword}/`,
    meanings: [],
    provenance: { headword: evidence, pronunciation: evidence }
  };
  return { id, startingBand, record };
}

describe("daily lessons", () => {
  it("assigns at most one daily delivery for a profile's local calendar date and retries it idempotently", () => {
    const lessons = new DailyLessons([
      lesson("candid", "candid", "Stretch my vocabulary"),
      lesson("lucid", "lucid", "Stretch my vocabulary")
    ]);
    const nearMidnightUtc = new Date("2026-08-27T00:30:00Z");

    const first = lessons.deliver("profile", "America/Los_Angeles", nearMidnightUtc)!;
    const retry = lessons.deliver("profile", "America/Los_Angeles", nearMidnightUtc)!;
    const tomorrow = lessons.deliver("profile", "America/Los_Angeles", new Date("2026-08-28T00:30:00Z"))!;

    expect(first).toEqual(retry);
    expect(first.localDate).toBe("2026-08-26");
    expect(tomorrow.localDate).toBe("2026-08-27");
    expect(lessons.history("profile")).toHaveLength(2);
  });

  it("uses a changed starting band only for future delivery and never repeats a delivered headword", () => {
    const lessons = new DailyLessons([
      lesson("candid", "candid", "Stretch my vocabulary"),
      lesson("candid-advanced", "candid", "Challenge me"),
      lesson("esoteric", "esoteric", "Challenge me")
    ]);
    const first = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"))!;

    lessons.setStartingBand("profile", "Challenge me");
    const second = lessons.deliver("profile", "UTC", new Date("2026-08-27T12:00:00Z"))!;

    expect(first.lessonId).toBe("candid");
    expect(second.lessonId).toBe("esoteric");
  });

  it("requires familiarity before reading and preserves it in history", () => {
    const lessons = new DailyLessons([lesson("candid", "candid", "Stretch my vocabulary")]);
    const delivery = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"))!;

    expect(() => lessons.readLesson("profile", delivery.id)).toThrow("Record familiarity");
    const familiar = lessons.recordFamiliarity("profile", delivery.id, "Seen it, unsure");

    expect(lessons.readLesson("profile", delivery.id)?.headword).toBe("candid");
    expect(lessons.history("profile")[0]).toMatchObject({ delivery: familiar, status: "current" });
    expect(() => lessons.recordFamiliarity("profile", delivery.id, "Know the meaning")).toThrow(
      "already recorded"
    );
  });

  it("renders refreshed current content and marks withdrawn content unavailable", () => {
    const published = lesson("candid", "candid", "Stretch my vocabulary");
    const lessons = new DailyLessons([
      published,
      lesson("candid-new", "candid", "Stretch my vocabulary"),
      lesson("lucid", "lucid", "Stretch my vocabulary")
    ]);
    lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"));

    const refreshed = lesson("candid-new", "candid", "Stretch my vocabulary");
    lessons.setPublishedLessons([
      refreshed,
      lesson("lucid", "lucid", "Stretch my vocabulary")
    ]);

    expect(lessons.history("profile")[0]).toMatchObject({
      status: "current",
      lesson: refreshed.record
    });

    lessons.setPublishedLessons([lesson("lucid", "lucid", "Stretch my vocabulary")]);
    expect(lessons.history("profile")[0]).toMatchObject({
      status: "unavailable",
      delivery: { lessonId: "candid" }
    });
    expect(
      lessons.deliver("profile", "UTC", new Date("2026-08-27T12:00:00Z"))?.lessonId
    ).toBe("lucid");
  });
});
