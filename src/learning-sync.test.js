import { describe, expect, it, vi } from "vitest";
import { HttpLearningStateAdapter, indexedDbStorage, LearningStateClient, LearningStateServer, practiceForDelivery } from "./learning-sync.js";
import { syntheticLesson } from "./fixtures/versioned-word-lesson.js";
import { versionedPractice } from "./fixtures/versioned-practice.js";

const day = 24 * 60 * 60 * 1000;

function lesson(id, headword, version = 1) {
  return { id, record: syntheticLesson(id, headword, version) };
}

function setup() {
  let time = new Date("2026-08-27T12:00:00Z");
  let clientContext = 1;
  const server = new LearningStateServer({
    lessons: [lesson("candid", "candid"), lesson("lucid", "lucid")],
    practiceItems: [{ ...versionedPractice, lessonId: "candid" }],
    now: () => time
  });
  const profile = server.createProfile();
  return {
    server,
    profile,
    client: () => new LearningStateClient({ server, profile, now: () => time, clientId: `test-client-${clientContext++}` }),
    setTime: (next) => { time = new Date(next); }
  };
}

function storage() {
  const values = new Map();
  return {
    load: (profile, clientId) => structuredClone(values.get(`${profile}:${clientId}`)),
    save: (profile, clientId, value) => values.set(`${profile}:${clientId}`, structuredClone(value)),
    clearProfile: (profile) => {
      for (const key of values.keys()) if (key.startsWith(`${profile}:`)) values.delete(key);
    }
  };
}

describe("learner synchronization seam", () => {
  it("rejects changes to a retained Practice revision even after withdrawal", () => {
    const { server } = setup();
    server.setPracticeItems([]);
    expect(() => server.setPracticeItems([{ ...versionedPractice, lessonId: "candid", explanation: "Overwritten." }])).toThrow("immutable");
  });
  it("restores current public attribution offline and discards it after withdrawal", async () => {
    const { server, profile } = setup();
    server.setPracticeItems([]);
    server.recordDelivery(profile, { id: "delivery-1", lessonId: "candid", localDate: "2026-08-27" });
    const persisted = storage();
    const first = new LearningStateClient({ server, profile, storage: persisted, clientId: "browser" });
    await first.synchronize();
    const replacement = lesson("candid", "candid", 2);
    replacement.record.meanings[0].examples[0] = "Replacement wording.";
    replacement.record.privateReply = "must not cache";
    server.setLessons([replacement]);
    await first.synchronize();
    const offline = new LearningStateClient({ server, profile, storage: persisted, clientId: "browser" });
    expect(offline.cache().lessons[0].record.publicationVersion).toBe(2);
    expect(offline.cache().lessons[0].record.sources).toEqual(replacement.record.sources);
    expect(offline.cache().lessons[0].record).not.toHaveProperty("privateReply");
    expect(offline.cache().practiceItems).toEqual([]);
    server.setLessons([]);
    await offline.synchronize();
    const reloaded = new LearningStateClient({ server, profile, storage: persisted, clientId: "browser" });
    expect(reloaded.cache().lessons).toEqual([]);
    expect(reloaded.cache().history[0].status).toBe("unavailable");
  });

  it("drops the prototype cache and outbox without converting them", () => {
    const persisted = storage();
    persisted.save("profile", "browser", { cache: { lessons: ["prototype"] }, outbox: [{ kind: "practice" }] });
    const client = new LearningStateClient({ server: {}, profile: "profile", storage: persisted, clientId: "browser" });
    expect(client.cache().lessons).toEqual([]);
    expect(client.outbox()).toEqual([]);
  });

  it("selects Practice by stable meaning and definition/POS, never by meaning position", () => {
    const lesson = syntheticLesson("lesson-candid", "candid");
    lesson.meanings.unshift({ ...lesson.meanings[0], id: "other-meaning" });
    const delivery = { id: "delivery", status: "current", recall: { dueAt: "2026-08-27T00:00:00Z" } };
    const now = new Date("2026-08-28T00:00:00Z");
    expect(practiceForDelivery(delivery, lesson, [], [], now)).toBeUndefined();
    expect(practiceForDelivery(delivery, lesson, [versionedPractice], [], now).practice.meaningId).toBe("meaning-candid-direct");
    lesson.meanings[1].definition = "Different definition";
    expect(practiceForDelivery(delivery, lesson, [versionedPractice], [], now)).toBeUndefined();
    lesson.meanings[1].definition = versionedPractice.definition;
    lesson.meanings[1].partOfSpeech = "noun";
    expect(practiceForDelivery(delivery, lesson, [versionedPractice], [], now)).toBeUndefined();
    lesson.meanings[1].partOfSpeech = "adjective";
    lesson.meanings[1].id = "split-meaning";
    expect(practiceForDelivery(delivery, lesson, [versionedPractice], [], now)).toBeUndefined();
  });
  it("constructs an HTTP adapter with its default browser client context", () => {
    expect(() => new HttpLearningStateAdapter({ fetch: () => {} })).not.toThrow();
  });

  it("calls the browser fetch function with its required global receiver", async () => {
    const originalFetch = globalThis.fetch;
    const fetch = vi.fn(function () {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return response(200, { status: "active", state: { lessons: [], history: [], evidence: [], mutable: [] } });
    });
    globalThis.fetch = fetch;
    const adapter = new HttpLearningStateAdapter({
      clientContextId: "browser-tab",
      session: { load: () => ({ grant: "grant" }), save() {}, clear() {} },
    });

    await expect(adapter.readState()).resolves.toMatchObject({ status: "active" });
    expect(fetch).toHaveBeenCalledOnce();
    globalThis.fetch = originalFetch;
  });

  it("keeps the app shell, fifty most recent lessons, history, and practice offline without sensitive profile data", async () => {
    const { server, profile, client } = setup();
    server.setLessons(Array.from({ length: 51 }, (_, index) => lesson(`lesson-${index}`, `word-${index}`)));
    for (let index = 0; index < 51; index += 1) {
      server.recordDelivery(profile, { id: `delivery-${index}`, lessonId: `lesson-${index}`, localDate: `2026-07-${String(index + 1).padStart(2, "0")}` });
    }
    const offline = client();

    await offline.synchronize();

    expect(offline.cache()).toMatchObject({ appShell: true, history: expect.any(Array), practiceItems: expect.any(Array) });
    expect(offline.cache().history).toHaveLength(50);
    expect(offline.cache().lessons).toHaveLength(50);
    expect(JSON.stringify(offline.cache())).not.toMatch(/session|passkey|recovery|analytics/i);
  });

  it("queues only permitted, idempotent learning changes while offline and expires them after thirty days", async () => {
    const { client, setTime } = setup();
    const offline = client();

    offline.record("familiarity", { deliveryId: "delivery-1", familiarity: "Completely new to me" });
    offline.record("practice", { deliveryId: "delivery-1", correct: true, practiceItemId: versionedPractice.itemId, practiceVersion: 1 });
    expect(() => offline.record("delivery", { lessonId: "candid" })).toThrow("cannot be queued");
    expect(offline.outbox()).toHaveLength(2);

    setTime(new Date("2026-08-27T12:00:00Z").getTime() + 31 * day);
    await offline.synchronize();
    expect(offline.outbox()).toEqual([]);
  });

  it("deduplicates retries, orders mutable changes by server acceptance, and recomputes recall from retained evidence", async () => {
    const { server, profile, client } = setup();
    server.recordDelivery(profile, { id: "delivery-1", lessonId: "candid", localDate: "2026-08-27" });
    const first = client();
    const second = client();
    await first.synchronize();
    await second.synchronize();

    const familiarity = first.record("familiarity", { deliveryId: "delivery-1", familiarity: "Completely new to me" });
    const practice = first.record("practice", { deliveryId: "delivery-1", correct: true, practiceItemId: versionedPractice.itemId, practiceVersion: 1 });
    await first.synchronize();
    first.retry(familiarity.id);
    first.retry(practice.id);
    second.record("familiarity", { deliveryId: "delivery-1", familiarity: "I use it all the time" });
    second.record("active-use", { deliveryId: "delivery-1", activeUse: "using" });
    await second.synchronize();
    await first.synchronize();

    expect(server.state(profile).evidence).toHaveLength(1);
    expect(first.cache().history[0]).toMatchObject({ familiarity: "I use it all the time", recall: { mastery: 5, stage: "3 days" } });
  });

  it("revalidates current content and clears local state when a remote deletion tombstone wins", async () => {
    const { server, profile, client } = setup();
    server.recordDelivery(profile, { id: "delivery-1", lessonId: "candid", localDate: "2026-08-27" });
    const offline = client();
    await offline.synchronize();
    server.setLessons([]);

    await offline.synchronize();
    expect(offline.cache().history).toEqual([{ id: "delivery-1", lessonId: "candid", localDate: "2026-08-27", status: "unavailable" }]);

    server.deleteProfile(profile);
    offline.record("utility", { deliveryId: "delivery-1", utility: "useful" });
    expect(offline.synchronize()).toEqual({ status: "deleted" });
    expect(offline.cache()).toEqual({ appShell: true, lessons: [], history: [], practiceItems: [], evidence: [], mutable: [] });
  });

  it("reports session expiry without accepting queued changes", async () => {
    const { server, profile, client } = setup();
    const offline = client();
    offline.record("content-quality", { deliveryId: "delivery-1" });
    server.expireSession(profile);

    expect(offline.synchronize()).toEqual({ status: "session-expired" });
    expect(offline.outbox()).toHaveLength(1);
  });

  it("restores a sanitized cache and queued changes after a client reload", async () => {
    const { server, profile, client } = setup();
    const persisted = storage();
    server.recordDelivery(profile, { id: "delivery-1", lessonId: "candid", localDate: "2026-08-27", recoveryEmail: "private@example.com" });
    const first = new LearningStateClient({ server, profile, storage: persisted, clientId: "browser-tab" });
    await first.synchronize();
    first.record("utility", { deliveryId: "delivery-1", utility: "useful" });

    const reloaded = new LearningStateClient({ server, profile, storage: persisted, clientId: "browser-tab" });
    expect(reloaded.cache().history[0]).not.toHaveProperty("recoveryEmail");
    expect(reloaded.outbox()).toHaveLength(1);
  });

  it("hydrates the server-issued delivery before offline rendering and queues changes for that delivery", async () => {
    const persisted = storage();
    const canonical = {
      practiceItems: [],
      lessons: [lesson("candid", "candid")],
      history: [{ id: "delivery-server-1", lessonId: "candid", localDate: "2026-08-27", status: "current" }],
      delivery: { id: "delivery-server-1", lessonId: "candid", localDate: "2026-08-27", status: "current" },
      evidence: [],
      mutable: [],
    };
    await persisted.save("server-profile", "browser-tab", {
      cacheVersion: "wordwell-cache-v2",
      cache: { appShell: true, lessons: canonical.lessons, history: canonical.history, delivery: canonical.delivery, practiceItems: [], evidence: [], mutable: [] },
      outbox: [],
      clientId: "browser-tab",
      nextOperation: 1,
    });
    const client = new LearningStateClient({
      server: {
        synchronize: (_profile, operations) => ({ status: "active", state: { ...canonical, evidence: operations, mutable: [] } }),
      },
      profile: "server-profile",
      storage: persisted,
      clientId: "browser-tab",
    });
    await client.ready();

    expect(client.cache().delivery.id).toBe("delivery-server-1");
    client.record("utility", { deliveryId: client.cache().delivery.id, utility: "useful" });
    expect(client.outbox()[0].deliveryId).toBe("delivery-server-1");
  });

  it("persists learner cache and outbox records in IndexedDB without using local storage", async () => {
    const storage = indexedDbStorage({ indexedDB: fakeIndexedDb() });
    const value = {
      cacheVersion: "wordwell-cache-v2",
      cache: { appShell: true, lessons: [], history: [], practiceItems: [], evidence: [], mutable: [] },
      outbox: [{ id: "browser:operation-1" }],
      clientId: "browser",
      nextOperation: 2
    };

    await storage.save("client:browser", "browser", value);
    expect(await storage.load("client:browser", "browser")).toEqual(value);
    const reloaded = new LearningStateClient({
      server: { synchronize: () => ({ status: "active", state: { lessons: [], practiceItems: [], history: [], evidence: [], mutable: [] } }) },
      profile: "client:browser",
      clientId: "browser",
      storage
    });
    await reloaded.ready();
    expect(reloaded.outbox()).toEqual(value.outbox);
    await storage.clearProfile("client:browser");
    expect(await storage.load("client:browser", "browser")).toBeUndefined();
  });

  it("uses a separate client-context session for HTTP state reads, syncs, renewals, and deletions", async () => {
    const sessions = new Map();
    const persisted = storage();
    const calls = [];
    const responses = [
      response(201, { profile: { state: "anonymous" }, session: { grant: "first-grant" } }),
      response(200, { status: "active", state: { lessons: [], practiceItems: [], history: [], evidence: [], mutable: [] } }),
      response(401, { status: "session-expired" }),
      response(200, { status: "active", session: { grant: "renewed-grant" } }),
      response(410, { status: "deleted" })
    ];
    const adapter = new HttpLearningStateAdapter({
      clientContextId: "browser-tab",
      fetch: async (url, options) => {
        calls.push({ url, options });
        return responses.shift();
      },
      session: {
        load: (clientId) => sessions.get(clientId),
        save: (clientId, session) => sessions.set(clientId, session),
        clear: (clientId) => sessions.delete(clientId)
      }
    });
    const client = new LearningStateClient({ server: adapter, profile: adapter.cacheKey, storage: persisted, clientId: "browser-tab" });

    await client.hydrate();
    client.record("utility", { deliveryId: "delivery-1", utility: "useful" });
    await expect(client.synchronize()).resolves.toEqual({ status: "session-expired" });
    expect(client.outbox()).toHaveLength(1);
    expect(JSON.stringify(persisted.load(adapter.cacheKey, "browser-tab"))).not.toMatch(/grant/);
    await expect(client.renewSession()).resolves.toEqual({ status: "active" });
    await expect(client.hydrate()).resolves.toEqual({ status: "deleted" });

    expect(calls.map(({ url, options }) => [url, options.method])).toEqual([
      ["/profiles/anonymous", "POST"],
      ["/learning-state", "GET"],
      ["/learning-state/sync", "POST"],
      ["/session/renew", "POST"],
      ["/learning-state", "GET"]
    ]);
    expect(calls[2].options.headers.authorization).toBe("Bearer first-grant");
    expect(calls[4].options.headers.authorization).toBe("Bearer renewed-grant");
    expect(client.outbox()).toEqual([]);
    expect(client.cache()).toEqual({ appShell: true, lessons: [], history: [], practiceItems: [], evidence: [], mutable: [] });
    expect(sessions.get("browser-tab")).toBeUndefined();
  });
});

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeIndexedDb() {
  const records = new Map();
  const database = {
    objectStoreNames: { contains: () => false },
    createObjectStore() {},
    transaction() {
      return {
        objectStore() {
          return {
            get: (id) => operation(() => records.get(id)),
            put: (record) => operation(() => records.set(record.id, structuredClone(record))),
            getAll: () => operation(() => [...records.values()].map((record) => structuredClone(record))),
            delete: (id) => operation(() => records.delete(id))
          };
        }
      };
    }
  };
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    }
  };

  function operation(action) {
    const request = {};
    queueMicrotask(() => {
      request.result = action();
      request.onsuccess?.();
    });
    return request;
  }
}
