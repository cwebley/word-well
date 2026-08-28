import { createHash } from "node:crypto";
import { createServer } from "node:http";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LearnerDatabase } from "./database.js";
import { createApi } from "./http.js";

const databaseUrl = process.env.DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);

let pool;
let database;
let server;
let baseUrl;
let now;

suite("learner HTTP seam", () => {
  beforeAll(async () => {
    now = new Date("2026-08-27T12:00:00Z");
    pool = new pg.Pool({ connectionString: databaseUrl });
    database = new LearnerDatabase({ pool, now: () => now });
    server = createServer(createApi(database));
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(async () => {
    now = new Date("2026-08-27T12:00:00Z");
    await pool.query("DELETE FROM reserved_upcoming_words");
    await pool.query("DELETE FROM skipped_upcoming_words");
    await pool.query("DELETE FROM learner_evidence");
    await pool.query("DELETE FROM learner_choices");
    await pool.query("DELETE FROM accepted_operations");
    await pool.query("DELETE FROM deliveries");
    await pool.query("DELETE FROM sessions");
    await pool.query("DELETE FROM profiles");
    await pool.query("DELETE FROM published_lessons");
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await database.close();
  });

  it("creates an anonymous profile and returns an empty learner-safe state", async () => {
    const created = await request("POST", "/profiles/anonymous");

    expect(created.response.status).toBe(201);
    expect(created.body.profile).toEqual({ state: "anonymous" });
    expect(created.body.session.grant).toEqual(expect.any(String));

    const state = await request("GET", "/learning-state", created.body.session.grant);
    expect(state.response.status).toBe(200);
    expect(state.body).toEqual({ status: "active", state: { lessons: [], history: [], evidence: [], mutable: [] } });
  });

  it("delivers one lesson per local date, promotes the reserved queue, and does not catch up missed dates", async () => {
    now = new Date("2026-08-27T00:30:00Z");
    const created = await request("POST", "/profiles/anonymous", undefined, undefined, "America/Los_Angeles");
    const profileId = await profileForGrant(created.body.session.grant);
    await seedPublishedLessons();

    const first = await request("GET", "/learning-state", created.body.session.grant, undefined, "America/Los_Angeles");
    expect(first.body.state.delivery).toMatchObject({ localDate: "2026-08-26", normalizedHeadword: "candid" });
    expect(first.body.state.history).toHaveLength(1);
    expect(first.body.state.upcoming).toHaveLength(2);

    const retry = await request("GET", "/learning-state", created.body.session.grant);
    expect(retry.body.state.history).toHaveLength(1);
    expect(retry.body.state.delivery.id).toBe(first.body.state.delivery.id);

    now = new Date("2026-08-29T00:30:00Z");
    const nextDate = await request("GET", "/learning-state", created.body.session.grant, undefined, "America/Los_Angeles");
    expect(nextDate.body.state.delivery.localDate).toBe("2026-08-28");
    expect(nextDate.body.state.history).toHaveLength(2);
    expect(nextDate.body.state.history.map(({ normalizedHeadword }) => normalizedHeadword)).toEqual(["lucid", "candid"]);
  });

  it("skips only reserved words and fills the vacancy without repeating the headword", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const profileId = await profileForGrant(created.body.session.grant);
    await seedPublishedLessons();
    const first = await request("GET", "/learning-state", created.body.session.grant);
    const skippedId = first.body.state.upcoming[0].id;

    const skipped = await request("POST", `/upcoming/${skippedId}/skip`, created.body.session.grant);

    expect(skipped.response.status).toBe(200);
    expect(skipped.body.state.upcoming.map(({ normalizedHeadword }) => normalizedHeadword)).toEqual(["plain"]);
    expect(skipped.body.state.history.map(({ normalizedHeadword }) => normalizedHeadword)).toEqual(["candid"]);

    const retry = await request("POST", `/upcoming/${skippedId}/skip`, created.body.session.grant);
    expect(retry.response.status).toBe(200);
    expect(retry.body.state.upcoming.map(({ normalizedHeadword }) => normalizedHeadword)).toEqual(["plain"]);
  });

  it("discards withdrawn upcoming content before promoting a later candidate", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const profileId = await profileForGrant(created.body.session.grant);
    await seedPublishedLessons();
    const first = await request("GET", "/learning-state", created.body.session.grant);
    await pool.query("UPDATE published_lessons SET available = false WHERE id = 'lesson-lucid'");

    now = new Date("2026-08-28T12:00:00Z");
    const nextDate = await request("GET", "/learning-state", created.body.session.grant);

    expect(nextDate.body.state.delivery.normalizedHeadword).toBe("plain");
    expect((nextDate.body.state.upcoming ?? []).map(({ normalizedHeadword }) => normalizedHeadword)).not.toContain("lucid");
    expect(first.body.state.upcoming.map(({ normalizedHeadword }) => normalizedHeadword)).toContain("lucid");
  });

  it("rotates session grants and rejects them after thirty days without contact", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const renewed = await request("POST", "/session/renew", created.body.session.grant);

    expect(renewed.response.status).toBe(200);
    expect(renewed.body.session.grant).not.toBe(created.body.session.grant);
    expect((await request("GET", "/learning-state", created.body.session.grant)).response.status).toBe(401);

    now = new Date("2026-09-26T12:00:01Z");
    const expired = await request("GET", "/learning-state", renewed.body.session.grant);
    expect(expired.response.status).toBe(401);
    expect(expired.body).toEqual({ status: "session-expired" });
  });

  it("accepts an idempotent sync batch and converges mutable state by acceptance order", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const profileId = await profileForGrant(created.body.session.grant);
    await seedLessonAndDelivery(profileId);
    const operation = {
      id: "browser:operation-1",
      kind: "familiarity",
      deliveryId: "delivery-1",
      familiarity: "Completely new to me",
      createdAt: now.toISOString()
    };
    const practice = {
      id: "browser:operation-2",
      kind: "practice",
      deliveryId: "delivery-1",
      correct: true,
      createdAt: now.toISOString()
    };

    const first = await request("POST", "/learning-state/sync", created.body.session.grant, { operations: [operation, practice] });
    expect(first.response.status).toBe(200);
    expect(first.body.state.history[0]).toMatchObject({
      id: "delivery-1",
      status: "current",
      familiarity: "Completely new to me",
      recall: { stage: "1 day", mastery: 1 }
    });
    expect(first.body.state.evidence).toHaveLength(1);

    const retry = await request("POST", "/learning-state/sync", created.body.session.grant, { operations: [operation, practice] });
    expect(retry.response.status).toBe(200);
    expect(retry.body.state.evidence).toHaveLength(1);

    const changed = await request("POST", "/learning-state/sync", created.body.session.grant, {
      operations: [{
        id: "second-client:operation-1",
        kind: "familiarity",
        deliveryId: "delivery-1",
        familiarity: "I use it all the time",
        createdAt: now.toISOString()
      }]
    });
    expect(changed.body.state.history[0]).toMatchObject({ familiarity: "I use it all the time" });
  });

  it("revalidates withdrawn content and gives tombstones precedence over sessions", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const profileId = await profileForGrant(created.body.session.grant);
    await seedLessonAndDelivery(profileId);
    await pool.query("UPDATE published_lessons SET available = false WHERE id = 'lesson-candid'");

    const unavailable = await request("GET", "/learning-state", created.body.session.grant);
    expect(unavailable.body.state.history[0]).toMatchObject({ id: "delivery-1", status: "unavailable" });
    expect(unavailable.body.state.lessons).toEqual([]);

    await pool.query("UPDATE profiles SET state = 'tombstoned', tombstoned_at = $1 WHERE id = $2", [now, profileId]);
    const deleted = await request("GET", "/learning-state", created.body.session.grant);
    expect(deleted.response.status).toBe(410);
    expect(deleted.body).toEqual({ status: "deleted" });
  });

  async function seedLessonAndDelivery(profileId) {
    await pool.query(
      "INSERT INTO published_lessons (id, normalized_headword, record) VALUES ($1, $2, $3)",
      ["lesson-candid", "candid", { headword: "candid", normalizedHeadword: "candid", provenance: { source: "private" } }]
    );
    await pool.query(
      "INSERT INTO deliveries (id, profile_id, local_date, lesson_id, normalized_headword) VALUES ($1, $2, $3, $4, $5)",
      ["delivery-1", profileId, "2026-08-27", "lesson-candid", "candid"]
    );
  }

  async function seedPublishedLessons() {
    for (const [id, headword] of [["lesson-candid", "candid"], ["lesson-lucid", "lucid"], ["lesson-plain", "plain"]]) {
      await pool.query(
        "INSERT INTO published_lessons (id, normalized_headword, record) VALUES ($1, $2, $3)",
        [id, headword, { headword, normalizedHeadword: headword, startingBand: "Stretch my vocabulary" }]
      );
    }
  }

  async function profileForGrant(grant) {
    const result = await pool.query("SELECT profile_id FROM sessions WHERE grant_digest = $1", [digest(grant)]);
    return result.rows[0].profile_id;
  }
});

async function request(method, path, grant, body, timeZone) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(grant ? { authorization: `Bearer ${grant}` } : {}),
      ...(timeZone ? { "x-time-zone": timeZone } : {}),
      ...(body ? { "content-type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { response, body: await response.json() };
}

function digest(grant) {
  return createHash("sha256").update(grant).digest("hex");
}
