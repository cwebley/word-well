import type { PublishedVocabularyRecord } from "./content-pipeline";

export type StartingBand =
  | "Build foundations"
  | "Stretch my vocabulary"
  | "Challenge me";

export type Familiarity =
  | "Never seen it"
  | "Seen it, unsure"
  | "Know the meaning"
  | "Could use it naturally";

export type PublishedLesson = {
  readonly id: string;
  readonly startingBand: StartingBand;
  readonly record: PublishedVocabularyRecord;
};

export type DailyDelivery = {
  readonly id: string;
  readonly profileId: string;
  readonly localDate: string;
  readonly lessonId: string;
  readonly normalizedHeadword: string;
  readonly familiarity?: Familiarity;
};

export type HistoryItem = {
  readonly delivery: DailyDelivery;
  readonly status: "current" | "unavailable";
  readonly lesson?: PublishedVocabularyRecord;
};

export class DailyLessons {
  private readonly profiles = new Map<
    string,
    { startingBand: StartingBand; deliveries: DailyDelivery[]; deliveredHeadwords: Set<string> }
  >();
  private lessons = new Map<string, PublishedLesson>();

  constructor(lessons: readonly PublishedLesson[]) {
    this.setPublishedLessons(lessons);
  }

  setPublishedLessons(lessons: readonly PublishedLesson[]) {
    this.lessons = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  }

  setStartingBand(profileId: string, startingBand: StartingBand) {
    this.profile(profileId).startingBand = startingBand;
  }

  deliver(profileId: string, timeZone: string, now = new Date()): DailyDelivery | undefined {
    const profile = this.profile(profileId);
    const localDate = dateInTimeZone(now, timeZone);
    const existing = profile.deliveries.find((delivery) => delivery.localDate === localDate);

    if (existing) {
      return existing;
    }

    const lesson = [...this.lessons.values()].find(
      (candidate) =>
        candidate.startingBand === profile.startingBand &&
        !profile.deliveredHeadwords.has(candidate.record.normalizedHeadword)
    );

    if (!lesson) {
      return undefined;
    }

    const delivery: DailyDelivery = {
      id: `${profileId}:${localDate}`,
      profileId,
      localDate,
      lessonId: lesson.id,
      normalizedHeadword: lesson.record.normalizedHeadword
    };
    profile.deliveries.push(delivery);
    profile.deliveredHeadwords.add(lesson.record.normalizedHeadword);
    return delivery;
  }

  recordFamiliarity(profileId: string, deliveryId: string, familiarity: Familiarity): DailyDelivery {
    const delivery = this.delivery(profileId, deliveryId);

    if (delivery.familiarity) {
      throw new Error("Familiarity was already recorded for this daily delivery.");
    }

    const updated = { ...delivery, familiarity };
    const deliveries = this.profile(profileId).deliveries;
    deliveries[deliveries.indexOf(delivery)] = updated;
    return updated;
  }

  readLesson(profileId: string, deliveryId: string): PublishedVocabularyRecord | undefined {
    const delivery = this.delivery(profileId, deliveryId);

    if (!delivery.familiarity) {
      throw new Error("Record familiarity before reading this word lesson.");
    }

    return this.currentLesson(delivery)?.record;
  }

  history(profileId: string): readonly HistoryItem[] {
    return [...this.profile(profileId).deliveries]
      .sort((left, right) => right.localDate.localeCompare(left.localDate))
      .map((delivery) => {
        const lesson = this.currentLesson(delivery)?.record;
        return lesson ? { delivery, status: "current", lesson } : { delivery, status: "unavailable" };
      });
  }

  private profile(profileId: string) {
    let profile = this.profiles.get(profileId);
    if (!profile) {
      profile = {
        startingBand: "Stretch my vocabulary",
        deliveries: [],
        deliveredHeadwords: new Set()
      };
      this.profiles.set(profileId, profile);
    }
    return profile;
  }

  private delivery(profileId: string, deliveryId: string): DailyDelivery {
    const delivery = this.profile(profileId).deliveries.find(
      (item) => item.id === deliveryId
    );
    if (!delivery) {
      throw new Error("Daily delivery was not found for this profile.");
    }
    return delivery;
  }

  private currentLesson(delivery: DailyDelivery): PublishedLesson | undefined {
    return [...this.lessons.values()].find(
      (lesson) => lesson.record.normalizedHeadword === delivery.normalizedHeadword
    );
  }
}

function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
