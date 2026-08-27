export class DailyLessons {
  #profiles = new Map();
  #lessons = new Map();

  constructor(lessons) {
    this.setPublishedLessons(lessons);
  }

  setPublishedLessons(lessons) {
    this.#lessons = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  }

  setStartingBand(profileId, startingBand) {
    this.#profile(profileId).startingBand = startingBand;
  }

  deliver(profileId, timeZone, now = new Date()) {
    const profile = this.#profile(profileId);
    const localDate = dateInTimeZone(now, timeZone);
    const existing = profile.deliveries.find((delivery) => delivery.localDate === localDate);

    if (existing) {
      return existing;
    }

    const lesson = [...this.#lessons.values()].find(
      (candidate) =>
        candidate.startingBand === profile.startingBand &&
        !profile.deliveredHeadwords.has(candidate.record.normalizedHeadword)
    );

    if (!lesson) {
      return undefined;
    }

    const delivery = {
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

  recordFamiliarity(profileId, deliveryId, familiarity) {
    const delivery = this.#delivery(profileId, deliveryId);

    if (delivery.familiarity) {
      throw new Error("Familiarity was already recorded for this daily delivery.");
    }

    const updated = { ...delivery, familiarity };
    const deliveries = this.#profile(profileId).deliveries;
    deliveries[deliveries.indexOf(delivery)] = updated;
    return updated;
  }

  reviseFamiliarity(profileId, deliveryId, familiarity) {
    const delivery = this.#delivery(profileId, deliveryId);

    if (!delivery.familiarity) {
      throw new Error("Record familiarity before revising it.");
    }

    const updated = { ...delivery, familiarity };
    const deliveries = this.#profile(profileId).deliveries;
    deliveries[deliveries.indexOf(delivery)] = updated;
    return updated;
  }

  readLesson(profileId, deliveryId) {
    const delivery = this.#delivery(profileId, deliveryId);

    if (!delivery.familiarity) {
      throw new Error("Record familiarity before reading this word lesson.");
    }

    return this.#currentLesson(delivery)?.record;
  }

  history(profileId) {
    return [...this.#profile(profileId).deliveries]
      .sort((left, right) => right.localDate.localeCompare(left.localDate))
      .map((delivery) => {
        const lesson = this.#currentLesson(delivery)?.record;
        return lesson
          ? { delivery, status: "current", lesson }
          : { delivery, status: "unavailable" };
      });
  }

  #profile(profileId) {
    let profile = this.#profiles.get(profileId);
    if (!profile) {
      profile = {
        startingBand: "Stretch my vocabulary",
        deliveries: [],
        deliveredHeadwords: new Set()
      };
      this.#profiles.set(profileId, profile);
    }
    return profile;
  }

  #delivery(profileId, deliveryId) {
    const delivery = this.#profile(profileId).deliveries.find((item) => item.id === deliveryId);
    if (!delivery) {
      throw new Error("Daily delivery was not found for this profile.");
    }
    return delivery;
  }

  #currentLesson(delivery) {
    return [...this.#lessons.values()].find(
      (lesson) => lesson.record.normalizedHeadword === delivery.normalizedHeadword
    );
  }
}

function dateInTimeZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
