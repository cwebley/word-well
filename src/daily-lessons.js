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

  recordFamiliarity(profileId, deliveryId, familiarity, now = new Date()) {
    const delivery = this.#delivery(profileId, deliveryId);

    if (delivery.familiarity) {
      throw new Error("Familiarity was already recorded for this daily delivery.");
    }

    this.#recordEvidence(profileId, { kind: "familiarity", deliveryId, familiarity }, now);
    return this.#rebuildDelivery(profileId, deliveryId);
  }

  reviseFamiliarity(profileId, deliveryId, familiarity, now = new Date()) {
    const delivery = this.#delivery(profileId, deliveryId);

    if (!delivery.familiarity) {
      throw new Error("Record familiarity before revising it.");
    }

    this.#recordEvidence(profileId, { kind: "familiarity", deliveryId, familiarity }, now);
    return this.#rebuildDelivery(profileId, deliveryId);
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

  practice(profileId, now = new Date()) {
    const due = this.dueRecall(profileId, now)[0];
    if (!due) return undefined;

    const lesson = this.#currentLesson(due);
    const attempts = this.#evidence(profileId, due.id).filter(({ kind }) => kind === "practice");
    const meaning = lesson.record.meanings[attempts.length % lesson.record.meanings.length];
    return { delivery: due, practice: meaning.practice };
  }

  answerPractice(profileId, deliveryId, answer, now = new Date()) {
    const delivery = this.#delivery(profileId, deliveryId);
    const due = this.dueRecall(profileId, now).some(({ id }) => id === deliveryId);
    if (!due) throw new Error("This word is not due for recall.");

    if (!["correct", "incorrect"].includes(answer)) throw new Error("Practice answer was not recognized.");
    const correct = answer === "correct";
    this.#recordEvidence(profileId, { kind: "practice", deliveryId, correct }, now);
    const updated = this.#rebuildDelivery(profileId, deliveryId);
    return { correct, delivery: updated };
  }

  dueRecall(profileId, now = new Date()) {
    return this.#profile(profileId).deliveries
      .filter((delivery) => delivery.recall?.dueAt && delivery.recall.dueAt <= now.toISOString())
      .sort((left, right) => left.recall.dueAt.localeCompare(right.recall.dueAt));
  }

  recordActiveUse(profileId, deliveryId, activeUse, now = new Date()) {
    this.#delivery(profileId, deliveryId);
    if (!["using", "not_using"].includes(activeUse)) throw new Error("Active use must be using or not_using.");
    this.#recordEvidence(profileId, { kind: "active-use", deliveryId, activeUse }, now);
    return this.#rebuildDelivery(profileId, deliveryId);
  }

  recordUtility(profileId, deliveryId, utility, now = new Date()) {
    this.#delivery(profileId, deliveryId);
    if (!["useful", "not_useful"].includes(utility)) throw new Error("Utility must be useful or not_useful.");
    return this.#recordEvidence(profileId, { kind: "utility", deliveryId, utility }, now);
  }

  reportContentQuality(profileId, deliveryId, now = new Date()) {
    this.#delivery(profileId, deliveryId);
    return this.#recordEvidence(profileId, { kind: "content-quality", deliveryId }, now);
  }

  resetRecall(profileId) {
    const profile = this.#profile(profileId);
    profile.deliveries.forEach((delivery) => this.#rebuildDelivery(profileId, delivery.id));
    return profile.deliveries;
  }

  #profile(profileId) {
    let profile = this.#profiles.get(profileId);
    if (!profile) {
      profile = {
        startingBand: "Stretch my vocabulary",
        deliveries: [],
        deliveredHeadwords: new Set(),
        evidence: []
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

  #recordEvidence(profileId, evidence, now = new Date()) {
    const event = { ...evidence, recordedAt: now.toISOString() };
    this.#profile(profileId).evidence.push(event);
    return event;
  }

  #evidence(profileId, deliveryId) {
    return this.#profile(profileId).evidence
      .filter((event) => event.deliveryId === deliveryId)
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
  }

  #rebuildDelivery(profileId, deliveryId) {
    const delivery = this.#delivery(profileId, deliveryId);
    const evidence = this.#evidence(profileId, deliveryId);
    const familiarity = [...evidence].reverse().find(({ kind }) => kind === "familiarity")?.familiarity;
    const activeUse = [...evidence].reverse().find(({ kind }) => kind === "active-use");
    let recall = familiarity ? { stage: "new", dueAt: evidence.find(({ kind }) => kind === "familiarity").recordedAt, mastery: familiarityMastery(familiarity) } : undefined;

    for (const event of evidence.filter(({ kind }) => kind === "practice")) {
      recall = transitionRecall(recall, event);
    }

    // Active use is a changeable state, so its latest value applies only once.
    if (recall && activeUse?.activeUse === "using") {
      recall = advanceRecall(recall, activeUse.recordedAt, 1);
    }

    const updated = { ...delivery, familiarity, recall };
    const deliveries = this.#profile(profileId).deliveries;
    deliveries[deliveries.indexOf(delivery)] = updated;
    return updated;
  }
}

const recallStages = [
  { name: "new", days: 0 },
  { name: "1 day", days: 1 },
  { name: "3 days", days: 3 },
  { name: "7 days", days: 7 },
  { name: "14 days", days: 14 },
  { name: "30 days", days: 30 }
];

function familiarityMastery(familiarity) {
  return {
    "Completely new to me": 0,
    "I think I've heard of it": 1,
    "Familiar, but I don't use it": 2,
    "I use it all the time": 3
  }[familiarity] ?? 0;
}

function transitionRecall(recall, event) {
  if (!recall) return recall;
  const stageIndex = recallStages.findIndex(({ name }) => name === recall.stage);
  const nextIndex = event.correct ? Math.min(stageIndex + 1, recallStages.length - 1) : Math.max(stageIndex - 1, 0);
  const next = recallStages[nextIndex];
  return {
    stage: next.name,
    dueAt: addDays(event.recordedAt, event.correct ? next.days : Math.max(1, next.days)),
    mastery: Math.max(0, recall.mastery + (event.correct ? 1 : -1))
  };
}

function advanceRecall(recall, recordedAt, masteryIncrease) {
  const stageIndex = recallStages.findIndex(({ name }) => name === recall.stage);
  const next = recallStages[Math.min(stageIndex + 1, recallStages.length - 1)];
  return { stage: next.name, dueAt: addDays(recordedAt, next.days), mastery: recall.mastery + masteryIncrease };
}

function addDays(iso, days) {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
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
