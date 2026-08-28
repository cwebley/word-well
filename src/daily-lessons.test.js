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
      meanings: [{
        practice: {
          prompt: `Which sentence uses ${headword} naturally?`,
          correctSentence: `The ${headword} answer fits.`,
          incorrectSentence: `The ${headword} calculator fits.`,
          explanation: "The answer fits the word's meaning; the calculator does not."
        }
      }]
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

  it("presents delivered words for due recall, advances explicit stages, and makes incorrect answers due sooner", () => {
    const lessons = new DailyLessons([lesson("candid", "candid", "Stretch my vocabulary")]);
    const delivery = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"));
    const started = new Date("2026-08-26T12:00:00Z");
    lessons.recordFamiliarity("profile", delivery.id, "Completely new to me", started);

    expect(lessons.practice("profile", started)).toMatchObject({ delivery: { id: delivery.id } });
    const correct = lessons.answerPractice("profile", delivery.id, "correct", started);

    expect(correct).toMatchObject({ correct: true, delivery: { recall: { stage: "1 day", dueAt: "2026-08-27T12:00:00.000Z", mastery: 1 } } });
    expect(lessons.dueRecall("profile", new Date("2026-08-26T12:00:01Z"))).toEqual([]);
    const incorrect = lessons.answerPractice("profile", delivery.id, "incorrect", new Date("2026-08-27T12:00:00Z"));

    expect(incorrect.delivery.recall).toMatchObject({ stage: "new", dueAt: "2026-08-28T12:00:00.000Z", mastery: 0 });
  });

  it("keeps utility and content quality as editorial evidence while active use modestly strengthens recall", () => {
    const lessons = new DailyLessons([lesson("candid", "candid", "Stretch my vocabulary")]);
    const delivery = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"));
    lessons.recordFamiliarity("profile", delivery.id, "Completely new to me", new Date("2026-08-26T12:00:00Z"));
    lessons.answerPractice("profile", delivery.id, "correct", new Date("2026-08-26T12:00:00Z"));

    const utility = lessons.recordUtility("profile", delivery.id, "not_useful", new Date("2026-08-26T13:00:00Z"));
    const quality = lessons.reportContentQuality("profile", delivery.id, new Date("2026-08-26T13:01:00Z"));
    const using = lessons.recordActiveUse("profile", delivery.id, "using", new Date("2026-08-26T14:00:00Z"));

    expect(utility).toMatchObject({ kind: "utility", utility: "not_useful" });
    expect(quality).toMatchObject({ kind: "content-quality" });
    expect(using.recall).toEqual({ stage: "3 days", dueAt: "2026-08-29T14:00:00.000Z", mastery: 2 });
  });

  it("rebuilds derived recall from retained familiarity, practice, and active-use evidence", () => {
    const lessons = new DailyLessons([lesson("candid", "candid", "Stretch my vocabulary")]);
    const delivery = lessons.deliver("profile", "UTC", new Date("2026-08-26T12:00:00Z"));
    lessons.recordFamiliarity("profile", delivery.id, "Completely new to me", new Date("2026-08-26T12:00:00Z"));
    lessons.answerPractice("profile", delivery.id, "correct", new Date("2026-08-26T12:00:00Z"));
    lessons.recordActiveUse("profile", delivery.id, "using", new Date("2026-08-26T14:00:00Z"));
    const beforeReset = lessons.history("profile")[0].delivery.recall;

    lessons.resetRecall("profile");

    expect(lessons.history("profile")[0].delivery.recall).toEqual(beforeReset);
  });

  it("restores cached learner evidence for offline history and practice", () => {
    const lessons = new DailyLessons([lesson("candid", "candid", "Stretch my vocabulary")]);
    lessons.restore("profile", {
      history: [{ id: "profile:2026-08-26", profileId: "profile", localDate: "2026-08-26", lessonId: "candid", normalizedHeadword: "candid", status: "current" }],
      mutable: [{ kind: "familiarity", deliveryId: "profile:2026-08-26", familiarity: "Completely new to me", acceptedAt: "2026-08-26T12:00:00.000Z" }],
      evidence: [{ kind: "practice", deliveryId: "profile:2026-08-26", correct: true, acceptedAt: "2026-08-26T12:00:00.000Z" }]
    });

    expect(lessons.history("profile")[0].delivery.recall).toEqual({ stage: "1 day", dueAt: "2026-08-27T12:00:00.000Z", mastery: 1 });
  });
});
