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
    await pool.query("DELETE FROM recovery_tokens");
    await pool.query("DELETE FROM passkey_challenges");
    await pool.query("DELETE FROM passkeys");
    await pool.query("DELETE FROM profile_access_events");
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

  it("refuses protection when the profile has no eligibility, then accepts it after meaningful history", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const grant = created.body.session.grant;
    const profileId = await profileForGrant(grant);

    const rejected = await request("POST", "/profile/protect", grant, {
      credential: { id: "cred-1", label: "Laptop", publicKey: fakePublicKey("1"), challenge: "stale" },
    });
    expect(rejected.response.status).toBe(400);

    await seedDeliveries(profileId, ["2026-08-25", "2026-08-26", "2026-08-27"]);
    const challenge = await request("POST", "/profile/passkey-challenge", grant, { purpose: "register" });
    expect(challenge.response.status).toBe(200);
    expect(challenge.body.challenge).toEqual(expect.any(String));

    const credential = {
      id: "cred-1",
      label: "Laptop",
      publicKey: fakePublicKey("cred-1"),
      challenge: challenge.body.challenge,
    };
    const protection = await request("POST", "/profile/protect", grant, { credential });
    expect(protection.response.status).toBe(200);
    expect(protection.body).toMatchObject({
      status: "protected",
      profile: {
        state: "protected",
        canProtect: true,
        passkeys: [{ id: "cred-1", label: "Laptop" }],
        recoveryEmail: null,
      },
    });
  });

  it("requires recent authentication before allowing passkey changes", async () => {
    const { grant } = await protectProfile();
    now = new Date("2026-08-27T12:06:00Z");

    const addChallenge = await request("POST", "/profile/passkey-challenge", grant, { purpose: "register" });
    expect(addChallenge.response.status).toBe(200);
    const denied = await request("POST", "/profile/passkeys", grant, {
      credential: { id: "cred-2", label: "Phone", publicKey: fakePublicKey("2"), challenge: addChallenge.body.challenge },
    });
    expect(denied.response.status).toBe(200);
    expect(denied.body).toEqual({ status: "authentication-required" });
  });

  it("supports adding and revoking multiple passkeys within the recent-auth window", async () => {
    const { grant } = await protectProfile();

    const addChallenge = await request("POST", "/profile/passkey-challenge", grant, { purpose: "register" });
    const added = await request("POST", "/profile/passkeys", grant, {
      credential: { id: "cred-2", label: "Phone", publicKey: fakePublicKey("2"), challenge: addChallenge.body.challenge },
    });
    expect(added.response.status).toBe(200);
    expect(added.body.profile.passkeys.map(({ label }) => label)).toEqual(["Laptop", "Phone"]);

    const revoked = await request("DELETE", "/profile/passkeys/cred-2", grant);
    expect(revoked.response.status).toBe(200);
    expect(revoked.body.profile.passkeys.map(({ label }) => label)).toEqual(["Laptop"]);
  });

  it("refuses to remove the last remaining passkey", async () => {
    const { grant } = await protectProfile();

    const removed = await request("DELETE", "/profile/passkeys/cred-1", grant);
    expect(removed.response.status).toBe(400);
    expect(removed.body.error).toMatch(/last/i);
  });

  it("refreshes the recent-authentication marker on a valid passkey assertion", async () => {
    const { grant } = await protectProfile();
    now = new Date("2026-08-27T12:06:00Z");

    const authChallenge = await request("POST", "/profile/passkey-challenge", grant, { purpose: "authenticate", credentialId: "cred-1" });
    expect(authChallenge.response.status).toBe(200);
    const auth = await request("POST", "/profile/authenticate", grant, {
      credential: { id: "cred-1", challenge: authChallenge.body.challenge },
    });
    expect(auth.response.status).toBe(200);
    expect(auth.body.status).toBe("protected");

    const addChallenge = await request("POST", "/profile/passkey-challenge", grant, { purpose: "register" });
    const added = await request("POST", "/profile/passkeys", grant, {
      credential: { id: "cred-2", label: "Phone", publicKey: fakePublicKey("2"), challenge: addChallenge.body.challenge },
    });
    expect(added.response.status).toBe(200);
  });

  it("issues, supersedes, and expires recovery-email verification tokens", async () => {
    const { grant } = await protectProfile();

    const requested = await request("POST", "/profile/recovery-email/request", grant, { email: "learner@example.com" });
    expect(requested.response.status).toBe(200);
    expect(requested.body.email).toBe("learner@example.com");
    expect(requested.body.token).toEqual(expect.any(String));

    const verified = await request("POST", "/profile/recovery-email/verify", undefined, { token: requested.body.token });
    expect(verified.response.status).toBe(200);
    expect(verified.body.profile.recoveryEmail).toBe("learner@example.com");

    const reused = await request("POST", "/profile/recovery-email/verify", undefined, { token: requested.body.token });
    expect(reused.response.status).toBe(400);

    const newer = await request("POST", "/profile/recovery-email/request", grant, { email: "another@example.com" });
    expect(newer.body.token).not.toBe(requested.body.token);

    const stale = await request("POST", "/profile/recovery-email/verify", undefined, { token: requested.body.token });
    expect(stale.response.status).toBe(400);
  });

  it("rejects recovery-email verification tokens past their expiry", async () => {
    const { grant } = await protectProfile();

    const requested = await request("POST", "/profile/recovery-email/request", grant, { email: "learner@example.com" });
    now = new Date("2026-08-27T12:16:00Z");

    const verified = await request("POST", "/profile/recovery-email/verify", undefined, { token: requested.body.token });
    expect(verified.response.status).toBe(400);
  });

  it("recovers into the same profile with a fresh session and revokes prior sessions", async () => {
    const { grant, profileId } = await protectProfile();
    const requested = await request("POST", "/profile/recovery-email/request", grant, { email: "learner@example.com" });
    await request("POST", "/profile/recovery-email/verify", undefined, { token: requested.body.token });

    const started = await request("POST", "/profile/recover/start", undefined, { email: "learner@example.com" });
    expect(started.response.status).toBe(200);
    expect(started.body.token).toEqual(expect.any(String));

    const completed = await request("POST", "/profile/recover/complete", undefined, {
      token: started.body.token,
      credential: { id: "cred-recovered", label: "Replacement", publicKey: fakePublicKey("recovered") },
    });
    expect(completed.response.status).toBe(200);
    expect(completed.body.session.grant).not.toBe(grant);

    const recovered = await pool.query("SELECT id FROM profiles");
    expect(recovered.rows[0].id).toBe(profileId);

    const oldSession = await request("GET", "/learning-state", grant);
    expect(oldSession.response.status).toBe(401);
    expect(oldSession.body).toEqual({ status: "session-expired" });

    const reused = await request("POST", "/profile/recover/complete", undefined, {
      token: started.body.token,
      credential: { id: "cred-recovered-2", label: "Another", publicKey: fakePublicKey("2") },
    });
    expect(reused.response.status).toBe(400);
  });

  it("rejects recovery tokens past their expiry", async () => {
    const { grant } = await protectProfile();
    const requested = await request("POST", "/profile/recovery-email/request", grant, { email: "learner@example.com" });
    await request("POST", "/profile/recovery-email/verify", undefined, { token: requested.body.token });

    const started = await request("POST", "/profile/recover/start", undefined, { email: "learner@example.com" });
    now = new Date("2026-08-27T12:16:00Z");

    const completed = await request("POST", "/profile/recover/complete", undefined, {
      token: started.body.token,
      credential: { id: "cred-recovered", label: "Replacement", publicKey: fakePublicKey("recovered") },
    });
    expect(completed.response.status).toBe(400);
  });

  it("rejects passkey registrations whose public key is not a 32-byte base64 string", async () => {
    const { grant } = await protectProfile();
    const addChallenge = await request("POST", "/profile/passkey-challenge", grant, { purpose: "register" });

    const rejected = await request("POST", "/profile/passkeys", grant, {
      credential: { id: "cred-bad", label: "Bad key", publicKey: "not-a-real-key", challenge: addChallenge.body.challenge },
    });
    expect(rejected.response.status).toBe(400);
    expect(rejected.body.error).toMatch(/publicKey/i);
  });

  it("refuses deletion from a session that has not recently authenticated", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const grant = created.body.session.grant;

    const denied = await request("POST", "/profile/delete", grant);
    expect(denied.response.status).toBe(200);
    expect(denied.body).toEqual({ status: "authentication-required" });
  });

  it("tombstones the profile on delete, blocks every endpoint with a deleted envelope, and persists the purge schedule", async () => {
    const { grant } = await protectProfile();

    const deleted = await request("POST", "/profile/delete", grant);
    expect(deleted.response.status).toBe(200);
    expect(deleted.body).toEqual({
      status: "tombstoned",
      deletedAt: now.toISOString(),
      retention: {
        liveDataPurgeAt: "2026-08-28T12:00:00.000Z",
        profileAnalyticsPurgeAt: "2026-08-28T12:00:00.000Z",
        backupExpiryAt: "2026-09-26T12:00:00.000Z",
        securityRecordExpiryAt: "2026-09-26T12:00:00.000Z",
        requestIpLogExpiryAt: "2026-09-03T12:00:00.000Z",
      },
    });

    const state = await request("GET", "/learning-state", grant);
    expect(state.response.status).toBe(410);
    expect(state.body).toEqual({ status: "deleted" });

    const sync = await request("POST", "/learning-state/sync", grant, { operations: [] });
    expect(sync.response.status).toBe(410);
    expect(sync.body).toEqual({ status: "deleted" });

    const renew = await request("POST", "/session/renew", grant);
    expect(renew.response.status).toBe(410);
    expect(renew.body).toEqual({ status: "deleted" });

    const profileState = await pool.query("SELECT state, purge_schedule FROM profiles");
    expect(profileState.rows[0].state).toBe("tombstoned");
    expect(profileState.rows[0].purge_schedule).toMatchObject({
      liveDataPurgeAt: expect.any(String),
      backupExpiryAt: expect.any(String),
    });
  });

  async function protectProfile() {
    const created = await request("POST", "/profiles/anonymous");
    const grant = created.body.session.grant;
    const profileId = await profileForGrant(grant);
    await seedDeliveries(profileId, ["2026-08-25", "2026-08-26", "2026-08-27"]);
    const challenge = await request("POST", "/profile/passkey-challenge", grant, { purpose: "register" });
    const response = await request("POST", "/profile/protect", grant, {
      credential: { id: "cred-1", label: "Laptop", publicKey: fakePublicKey("1"), challenge: challenge.body.challenge },
    });
    expect(response.response.status).toBe(200);
    return { grant, profileId };
  }

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

  async function seedDeliveries(profileId, dates) {
    for (const date of dates) {
      await pool.query(
        "INSERT INTO published_lessons (id, normalized_headword, record) VALUES ($1, $2, $3)",
        [`lesson-${date}`, `headword-${date}`, { headword: `headword-${date}`, normalizedHeadword: `headword-${date}`, meanings: [{ definition: "test", examples: ["example"] }] }]
      );
      await pool.query(
        "INSERT INTO deliveries (id, profile_id, local_date, lesson_id, normalized_headword) VALUES ($1, $2, $3, $4, $5)",
        [`delivery-${date}`, profileId, date, `lesson-${date}`, `headword-${date}`]
      );
    }
  }

  async function seedPublishedLessons() {
    for (const [id, headword] of [["lesson-candid", "candid"], ["lesson-lucid", "lucid"], ["lesson-plain", "plain"]]) {
      await pool.query(
        "INSERT INTO published_lessons (id, normalized_headword, record) VALUES ($1, $2, $3)",
        [id, headword, {
          headword,
          normalizedHeadword: headword,
          startingBand: "Stretch my vocabulary",
          meanings: [{
            definition: "A test meaning.",
            examples: ["A first example.", "A second example.", "A third example."],
            useItWhen: "testing delivery",
            doNotUseItFor: "anything else",
            synonyms: ["test"],
            partOfSpeech: "noun",
            practice: {
              prompt: "Which example is correct?",
              correctSentence: "A first example.",
              incorrectSentence: "A second example.",
              explanation: "This is test content."
            }
          }]
        }]
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

function fakePublicKey(seed) {
  const bytes = Buffer.alloc(32);
  const view = bytes.toString("hex");
  for (let index = 0; index < seed.length; index += 1) {
    bytes[index] = (seed.charCodeAt(index) * 31 + index * 17) & 0xff;
  }
  return bytes.toString("base64");
}
