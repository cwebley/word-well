import { describe, expect, it } from "vitest";
import { LearningStateClient, LearningStateServer } from "./learning-sync.js";

const day = 24 * 60 * 60 * 1000;

function lesson(id, headword, version = "1") {
  return { id, record: { headword, normalizedHeadword: headword, version } };
}

function setup() {
  let time = new Date("2026-08-27T12:00:00Z");
  let clientContext = 1;
  const server = new LearningStateServer({
    lessons: [lesson("candid", "candid"), lesson("lucid", "lucid")],
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
  it("keeps the app shell, fifty most recent lessons, history, and practice offline without sensitive profile data", () => {
    const { server, profile, client } = setup();
    server.setLessons(Array.from({ length: 51 }, (_, index) => lesson(`lesson-${index}`, `word-${index}`)));
    for (let index = 0; index < 51; index += 1) {
      server.recordDelivery(profile, { id: `delivery-${index}`, lessonId: `lesson-${index}`, localDate: `2026-07-${String(index + 1).padStart(2, "0")}` });
    }
    const offline = client();

    offline.synchronize();

    expect(offline.cache()).toMatchObject({ appShell: true, history: expect.any(Array), practice: expect.any(Array) });
    expect(offline.cache().history).toHaveLength(50);
    expect(offline.cache().lessons).toHaveLength(50);
    expect(JSON.stringify(offline.cache())).not.toMatch(/session|passkey|recovery|analytics/i);
  });

  it("queues only permitted, idempotent learning changes while offline and expires them after thirty days", () => {
    const { client, setTime } = setup();
    const offline = client();

    offline.record("familiarity", { deliveryId: "delivery-1", familiarity: "Completely new to me" });
    offline.record("practice", { deliveryId: "delivery-1", correct: true });
    expect(() => offline.record("delivery", { lessonId: "candid" })).toThrow("cannot be queued");
    expect(offline.outbox()).toHaveLength(2);

    setTime(new Date("2026-08-27T12:00:00Z").getTime() + 31 * day);
    offline.synchronize();
    expect(offline.outbox()).toEqual([]);
  });

  it("deduplicates retries, orders mutable changes by server acceptance, and recomputes recall from retained evidence", () => {
    const { server, profile, client } = setup();
    server.recordDelivery(profile, { id: "delivery-1", lessonId: "candid", localDate: "2026-08-27" });
    const first = client();
    const second = client();
    first.synchronize();
    second.synchronize();

    const familiarity = first.record("familiarity", { deliveryId: "delivery-1", familiarity: "Completely new to me" });
    const practice = first.record("practice", { deliveryId: "delivery-1", correct: true });
    first.synchronize();
    first.retry(familiarity.id);
    first.retry(practice.id);
    second.record("familiarity", { deliveryId: "delivery-1", familiarity: "I use it all the time" });
    second.record("active-use", { deliveryId: "delivery-1", activeUse: "using" });
    second.synchronize();
    first.synchronize();

    expect(server.state(profile).evidence).toHaveLength(1);
    expect(first.cache().history[0]).toMatchObject({ familiarity: "I use it all the time", recall: { mastery: 5, stage: "3 days" } });
  });

  it("revalidates current content and clears local state when a remote deletion tombstone wins", () => {
    const { server, profile, client } = setup();
    server.recordDelivery(profile, { id: "delivery-1", lessonId: "candid", localDate: "2026-08-27" });
    const offline = client();
    offline.synchronize();
    server.setLessons([]);

    offline.synchronize();
    expect(offline.cache().history).toEqual([{ id: "delivery-1", lessonId: "candid", localDate: "2026-08-27", status: "unavailable" }]);

    server.deleteProfile(profile);
    offline.record("utility", { deliveryId: "delivery-1", utility: "useful" });
    expect(offline.synchronize()).toEqual({ status: "deleted" });
    expect(offline.cache()).toEqual({ appShell: true, lessons: [], history: [], practice: [] });
  });

  it("reports session expiry without accepting queued changes", () => {
    const { server, profile, client } = setup();
    const offline = client();
    offline.record("content-quality", { deliveryId: "delivery-1" });
    server.expireSession(profile);

    expect(offline.synchronize()).toEqual({ status: "session-expired" });
    expect(offline.outbox()).toHaveLength(1);
  });

  it("restores a sanitized cache and queued changes after a client reload", () => {
    const { server, profile, client } = setup();
    const persisted = storage();
    server.recordDelivery(profile, { id: "delivery-1", lessonId: "candid", localDate: "2026-08-27", recoveryEmail: "private@example.com" });
    const first = new LearningStateClient({ server, profile, storage: persisted, clientId: "browser-tab" });
    first.synchronize();
    first.record("utility", { deliveryId: "delivery-1", utility: "useful" });

    const reloaded = new LearningStateClient({ server, profile, storage: persisted, clientId: "browser-tab" });
    expect(reloaded.cache().history[0]).not.toHaveProperty("recoveryEmail");
    expect(reloaded.outbox()).toHaveLength(1);
  });
});
