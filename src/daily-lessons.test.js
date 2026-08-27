import { describe, expect, it } from "vitest";
import { DailyLessons } from "./daily-lessons.js";

function lesson(id, headword, startingBand) {
  return {
    id,
    startingBand,
    record: {
      headword,
      normalizedHeadword: headword.toLowerCase(),
      version: "1",
      pronunciation: `/${headword}/`,
      meanings: []
    }
  };
}

describe("daily lessons", () => {
  it("assigns at most one daily delivery for a profile's local calendar date", () => {
    const lessons = new DailyLessons([
      lesson("candid", "candid", "Stretch my vocabulary"),
      lesson("lucid", "lucid", "Stretch my vocabulary")
    ]);
    const nearMidnightUtc = new Date("2026-08-27T00:30:00Z");

    const first = lessons.deliver("profile", "America/Los_Angeles", nearMidnightUtc);
    const retry = lessons.deliver("profile", "America/Los_Angeles", nearMidnightUtc);
    const tomorrow = lessons.deliver("profile", "America/Los_Angeles", new Date("2026-08-28T00:30:00Z"));

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
    const first = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"));

    lessons.setStartingBand("profile", "Challenge me");
    const second = lessons.deliver("profile", "UTC", new Date("2026-08-27T12:00:00Z"));

    expect(first.lessonId).toBe("candid");
    expect(second.lessonId).toBe("esoteric");
  });

  it("requires familiarity before reading and preserves it in history", () => {
    const lessons = new DailyLessons([lesson("candid", "candid", "Stretch my vocabulary")]);
    const delivery = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"));

    expect(() => lessons.readLesson("profile", delivery.id)).toThrow("Record familiarity");
    const familiar = lessons.recordFamiliarity("profile", delivery.id, "Seen it, unsure");

    expect(lessons.readLesson("profile", delivery.id)?.headword).toBe("candid");
    expect(lessons.history("profile")[0]).toMatchObject({ delivery: familiar, status: "current" });
  });

  it("revises recorded familiarity without creating a delivery", () => {
    const lessons = new DailyLessons([lesson("candid", "candid", "Stretch my vocabulary")]);
    const delivery = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"));
    lessons.recordFamiliarity("profile", delivery.id, "Seen it, unsure");

    const revised = lessons.reviseFamiliarity("profile", delivery.id, "Could use it naturally");

    expect(revised.familiarity).toBe("Could use it naturally");
    expect(lessons.history("profile")).toHaveLength(1);
  });
});
