const maxCachedLessons = 50;
const maxOutboxOperations = 100;
const outboxLifetime = 30 * 24 * 60 * 60 * 1000;
const permittedKinds = new Set(["familiarity", "practice", "active-use", "utility", "content-quality"]);
const appendOnlyKinds = new Set(["practice", "utility", "content-quality"]);
let nextClient = 1;

export class LearningStateServer {
  #profiles = new Map();
  #lessons = new Map();
  #now;
  #nextProfile = 1;
  #nextOrder = 1;

  constructor({ lessons = [], now = () => new Date() } = {}) {
    this.#now = now;
    this.setLessons(lessons);
  }

  createProfile() {
    const id = `profile-${this.#nextProfile++}`;
    this.#profiles.set(id, { state: "active", session: "active", deliveries: [], evidence: [], mutable: new Map(), received: new Set() });
    return id;
  }

  setLessons(lessons) {
    this.#lessons = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  }

  recordDelivery(profileId, delivery) {
    this.#profile(profileId).deliveries.push({ ...delivery });
  }

  expireSession(profileId) {
    this.#profile(profileId).session = "expired";
  }

  deleteProfile(profileId) {
    this.#profile(profileId).state = "tombstoned";
  }

  synchronize(profileId, operations) {
    const profile = this.#profile(profileId);
    if (profile.state === "tombstoned") return { status: "deleted" };
    if (profile.session === "expired") return { status: "session-expired" };

    for (const operation of operations) this.#accept(profile, operation);
    return { status: "active", state: this.state(profileId) };
  }

  state(profileId) {
    const profile = this.#profile(profileId);
    const evidence = [...profile.evidence].sort(byOrder);
    const mutable = [...profile.mutable.values()].sort(byOrder);
    const history = profile.deliveries
      .map((delivery) => {
        const lesson = this.#lessons.get(delivery.lessonId);
        const changes = mutable.filter((event) => event.deliveryId === delivery.id);
        const deliveryEvidence = evidence.filter((event) => event.deliveryId === delivery.id);
        const familiarity = changes.find((event) => event.kind === "familiarity")?.familiarity;
        const activeUse = changes.find((event) => event.kind === "active-use")?.activeUse;
        return { ...delivery, status: lesson ? "current" : "unavailable", familiarity, recall: rebuildRecall(familiarity, activeUse, deliveryEvidence) };
      })
      .sort((left, right) => right.localDate.localeCompare(left.localDate));
    return { evidence, history, lessons: [...this.#lessons.values()] };
  }

  #accept(profile, operation) {
    if (!permittedKinds.has(operation.kind) || profile.received.has(operation.id)) return;
    const accepted = { ...operation, acceptedAt: this.#now().toISOString(), order: this.#nextOrder++ };
    profile.received.add(operation.id);
    if (appendOnlyKinds.has(operation.kind)) profile.evidence.push(accepted);
    else profile.mutable.set(`${operation.deliveryId}:${operation.kind}`, accepted);
  }

  #profile(profileId) {
    const profile = this.#profiles.get(profileId);
    if (!profile) throw new Error("Profile was not found.");
    return profile;
  }
}

export class LearningStateClient {
  #server;
  #profile;
  #now;
  #outbox = [];
  #sent = new Map();
  #nextOperation = 1;
  #clientId = `client-${nextClient++}`;
  #cache = { appShell: true, lessons: [], history: [], practice: [] };

  constructor({ server, profile, now = () => new Date() }) {
    this.#server = server;
    this.#profile = profile;
    this.#now = now;
  }

  record(kind, details) {
    if (!permittedKinds.has(kind)) throw new Error(`${kind} cannot be queued while offline.`);
    const operation = { id: `${this.#clientId}:operation-${this.#nextOperation++}`, kind, ...details, createdAt: this.#now().toISOString() };
    this.#outbox.push(operation);
    if (this.#outbox.length > maxOutboxOperations) this.#outbox.shift();
    return operation;
  }

  retry(operationId) {
    const operation = this.#sent.get(operationId);
    if (operation) this.#outbox.push(operation);
  }

  synchronize() {
    this.#outbox = this.#outbox.filter((operation) => this.#now() - new Date(operation.createdAt) <= outboxLifetime);
    const response = this.#server.synchronize(this.#profile, this.#outbox);
    if (response.status === "deleted") {
      this.#outbox = [];
      this.#sent.clear();
      this.#cache = { appShell: true, lessons: [], history: [], practice: [] };
      return { status: "deleted" };
    }
    if (response.status === "session-expired") return { status: "session-expired" };

    for (const operation of this.#outbox) this.#sent.set(operation.id, operation);
    this.#outbox = [];
    this.#cache = cache(response.state);
    return { status: "active" };
  }

  cache() {
    return structuredClone(this.#cache);
  }

  outbox() {
    return structuredClone(this.#outbox);
  }
}

function cache(state) {
  const history = state.history.slice(0, maxCachedLessons);
  const lessonIds = new Set(history.filter(({ status }) => status === "current").map(({ lessonId }) => lessonId));
  return {
    appShell: true,
    lessons: state.lessons.filter(({ id }) => lessonIds.has(id)),
    history,
    practice: history.filter(({ recall }) => recall)
  };
}

function rebuildRecall(familiarity, activeUse, evidence) {
  if (!familiarity) return undefined;
  let mastery = familiarity === "I use it all the time" ? 3 : familiarity === "Familiar, but I don't use it" ? 2 : familiarity === "I think I've heard of it" ? 1 : 0;
  let stage = "new";
  for (const event of evidence) {
    if (event.kind !== "practice") continue;
    if (event.correct) {
      stage = nextStage(stage);
      mastery += 1;
    } else {
      stage = previousStage(stage);
      mastery = Math.max(0, mastery - 1);
    }
  }
  if (activeUse === "using") {
    stage = nextStage(stage);
    mastery += 1;
  }
  return { stage, mastery };
}

function nextStage(stage) {
  const stages = ["new", "1 day", "3 days", "7 days", "14 days", "30 days"];
  return stages[Math.min(stages.indexOf(stage) + 1, stages.length - 1)];
}

function previousStage(stage) {
  const stages = ["new", "1 day", "3 days", "7 days", "14 days", "30 days"];
  return stages[Math.max(stages.indexOf(stage) - 1, 0)];
}

function byOrder(left, right) {
  return left.order - right.order;
}
