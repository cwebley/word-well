const maxCachedLessons = 50;
const maxOutboxOperations = 100;
const outboxLifetime = 30 * 24 * 60 * 60 * 1000;
const permittedKinds = new Set(["familiarity", "practice", "active-use", "utility", "content-quality"]);
const appendOnlyKinds = new Set(["practice", "utility", "content-quality"]);
const recallStages = ["new", "1 day", "3 days", "7 days", "14 days", "30 days"];

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
    return { evidence, mutable, history, lessons: [...this.#lessons.values()] };
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
  #storage;
  #outbox = [];
  #sent = new Map();
  #nextOperation = 1;
  #clientId;
  #cache = { appShell: true, lessons: [], history: [], practice: [] };

  constructor({ server, profile, now = () => new Date(), storage = browserStorage(), clientId = clientContextId() }) {
    this.#server = server;
    this.#profile = profile;
    this.#now = now;
    this.#storage = storage;
    const saved = storage.load(profile, clientId);
    if (saved) {
      this.#outbox = saved.outbox;
      this.#cache = saved.cache;
      this.#clientId = saved.clientId;
      this.#nextOperation = saved.nextOperation;
    } else {
      this.#clientId = clientId;
    }
  }

  record(kind, details) {
    if (!permittedKinds.has(kind)) throw new Error(`${kind} cannot be queued while offline.`);
    const operation = { id: `${this.#clientId}:operation-${this.#nextOperation++}`, kind, ...details, createdAt: this.#now().toISOString() };
    this.#queue(operation);
    this.#save();
    return operation;
  }

  retry(operationId) {
    const operation = this.#sent.get(operationId);
    if (operation) {
      this.#queue(operation);
      this.#save();
    }
  }

  synchronize() {
    this.#outbox = this.#outbox.filter((operation) => this.#now() - new Date(operation.createdAt) <= outboxLifetime);
    const response = this.#server.synchronize(this.#profile, this.#outbox);
    if (response.status === "deleted") {
      this.#outbox = [];
      this.#sent.clear();
      this.#cache = { appShell: true, lessons: [], history: [], practice: [] };
      this.#storage.clearProfile(this.#profile);
      return { status: "deleted" };
    }
    if (response.status === "session-expired") {
      this.#save();
      return { status: "session-expired" };
    }

    for (const operation of this.#outbox) this.#sent.set(operation.id, operation);
    this.#outbox = [];
    this.#cache = cache(response.state);
    this.#save();
    return { status: "active" };
  }

  cache() {
    return structuredClone(this.#cache);
  }

  outbox() {
    return structuredClone(this.#outbox);
  }

  #queue(operation) {
    this.#outbox.push(operation);
    if (this.#outbox.length > maxOutboxOperations) this.#outbox.shift();
  }

  #save() {
    this.#storage.save(this.#profile, this.#clientId, {
      cache: this.#cache,
      outbox: this.#outbox,
      clientId: this.#clientId,
      nextOperation: this.#nextOperation
    });
  }
}

function cache(state) {
  const history = state.history.slice(0, maxCachedLessons);
  const lessonIds = new Set(history.filter(({ status }) => status === "current").map(({ lessonId }) => lessonId));
  return {
    appShell: true,
    lessons: state.lessons.filter(({ id }) => lessonIds.has(id)).map(learnerSafe),
    history: history.map(learnerSafe),
    practice: history.filter(({ recall }) => recall).map(learnerSafe),
    evidence: state.evidence.map(learnerSafe),
    mutable: state.mutable.map(learnerSafe)
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
  return recallStages[Math.min(recallStages.indexOf(stage) + 1, recallStages.length - 1)];
}

function previousStage(stage) {
  return recallStages[Math.max(recallStages.indexOf(stage) - 1, 0)];
}

function byOrder(left, right) {
  return left.order - right.order;
}

function learnerSafe(value) {
  if (Array.isArray(value)) return value.map(learnerSafe);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/session|passkey|credential|recovery|analytics|pipeline.*evidence/i.test(key))
    .map(([key, item]) => [key, learnerSafe(item)]));
}

function browserStorage() {
  const storage = globalThis.localStorage;
  const key = (profile, clientId) => `wordwell:learning-state:${profile}:${clientId}`;
  return {
    load(profile, clientId) {
      const value = storage?.getItem(key(profile, clientId));
      return value ? JSON.parse(value) : undefined;
    },
    save(profile, clientId, value) {
      storage?.setItem(key(profile, clientId), JSON.stringify(value));
    },
    clearProfile(profile) {
      const prefix = `wordwell:learning-state:${profile}:`;
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const storageKey = storage.key(index);
        if (storageKey?.startsWith(prefix)) storage.removeItem(storageKey);
      }
    }
  };
}

function clientContextId() {
  const key = "wordwell:client-context";
  const stored = globalThis.sessionStorage?.getItem(key);
  if (stored) return stored;
  const clientId = `client-${crypto.randomUUID()}`;
  globalThis.sessionStorage?.setItem(key, clientId);
  return clientId;
}
