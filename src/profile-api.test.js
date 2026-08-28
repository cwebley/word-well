import { describe, expect, it } from "vitest";
import { HttpProfileAdapter } from "./profile-api.js";

function memorySession() {
  const values = new Map();
  return {
    load(clientId) {
      return values.has(clientId) ? structuredClone(values.get(clientId)) : undefined;
    },
    save(clientId, value) {
      values.set(clientId, structuredClone(value));
    },
    clear(clientId) {
      values.delete(clientId);
    },
  };
}

function adapter({ handlers, session = memorySession(), clientId = "client-test", fetch_ = defaultFetch(handlers) } = {}) {
  return new HttpProfileAdapter({
    fetch: fetch_,
    baseUrl: "http://api.local",
    session,
    clientContextId: clientId,
    timeZone: "UTC",
  });
}

function defaultFetch(handlers) {
  return async (url, init) => {
    const route = handlers[init?.method ?? "GET"]?.[url.replace("http://api.local", "")];
    if (!route) return new Response(JSON.stringify({ error: "Not found." }), { status: 404 });
    return route(init);
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HttpProfileAdapter seam", () => {
  it("creates an anonymous profile and surfaces the learner-safe profile from readProfile", async () => {
    const session = memorySession();
    const anonCalls = [];
    const profiles = new Map();
    const fetch_ = async (url, init) => {
      const path = url.replace("http://api.local", "");
      if (init?.method === "POST" && path === "/profiles/anonymous") {
        anonCalls.push(init);
        profiles.set("client-test", { profile: { state: "anonymous", id: "profile-1" }, session: { grant: "grant-anon", expiresAt: "2026-09-26T12:00:00.000Z" } });
        session.save("client-test", { grant: "grant-anon", expiresAt: "2026-09-26T12:00:00.000Z" });
        return jsonResponse(201, profiles.get("client-test"));
      }
      return jsonResponse(200, { status: "anonymous", profile: { state: "anonymous", canProtect: true, passkeys: [], recoveryEmail: null } });
    };

    const result = await new HttpProfileAdapter({ fetch: fetch_, baseUrl: "http://api.local", session, clientContextId: "client-test", timeZone: "UTC" }).readProfile();
    expect(anonCalls).toHaveLength(1);
    expect(result.profile).toEqual({ state: "anonymous", canProtect: true, passkeys: [], recoveryEmail: null });
  });

  it("pipes the protect response shape into a learner-safe profile", async () => {
    const session = memorySession();
    session.save("client-test", { grant: "grant-1", expiresAt: "2026-09-26T12:00:00.000Z" });
    const profile = { state: "protected", canProtect: true, passkeys: [{ id: "cred-1", label: "Laptop" }], recoveryEmail: null };
    const fetch_ = async (url, init) => {
      const path = url.replace("http://api.local", "");
      if (path === "/profile/protect" && init?.method === "POST") {
        const body = JSON.parse(init.body);
        expect(body.credential.challenge).toBe("challenge-1");
        return jsonResponse(200, { status: "protected", profile });
      }
      return jsonResponse(404, { error: "Not found." });
    };

    const result = await new HttpProfileAdapter({ fetch: fetch_, baseUrl: "http://api.local", session, clientContextId: "client-test", timeZone: "UTC" }).protect({ id: "cred-1", label: "Laptop", publicKey: "pk-1", challenge: "challenge-1" });
    expect(result.status).toBe("protected");
    expect(result.profile.passkeys).toEqual([{ id: "cred-1", label: "Laptop" }]);
  });

  it("re-authenticates before sending a recovery-email request", async () => {
    const calls = [];
    const session = memorySession();
    session.save("client-test", { grant: "grant-1", expiresAt: "2026-09-26T12:00:00.000Z" });
    const fetch_ = async (url, init) => {
      const path = url.replace("http://api.local", "");
      calls.push({ path, method: init?.method });
      if (path === "/profile/passkey-challenge") {
        const body = JSON.parse(init.body);
        if (body.purpose === "authenticate") return jsonResponse(200, { challenge: "auth-chal" });
        return jsonResponse(200, { challenge: "reg-chal" });
      }
      if (path === "/profile/authenticate") return jsonResponse(200, { status: "protected", profile: { state: "protected", canProtect: true, passkeys: [{ id: "cred-1", label: "Laptop" }], recoveryEmail: null } });
      if (path === "/profile/recovery-email/request") return jsonResponse(200, { token: "tok", email: "learner@example.com", expiresAt: "2026-08-27T12:15:00.000Z" });
      return jsonResponse(404, { error: "Not found." });
    };

    const profile = { state: "protected", canProtect: true, passkeys: [{ id: "cred-1", label: "Laptop" }], recoveryEmail: null };
    const client = new ProfileClientForTest({ fetch_, session, profile });
    const result = await client.requestRecoveryEmail("learner@example.com");
    expect(result.token).toBe("tok");
    expect(calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
      "POST /profile/passkey-challenge",
      "POST /profile/authenticate",
      "POST /profile/recovery-email/request",
    ]);
  });

  it("treats a deleted envelope as terminal and clears the cached session", async () => {
    const session = memorySession();
    session.save("client-test", { grant: "grant-1", expiresAt: "2026-09-26T12:00:00.000Z" });
    const fetch_ = async () => jsonResponse(410, { status: "deleted" });
    const adapterInstance = new HttpProfileAdapter({ fetch: fetch_, baseUrl: "http://api.local", session, clientContextId: "client-test", timeZone: "UTC" });
    const result = await adapterInstance.deleteProfile();
    expect(result.status).toBe("deleted");
    expect(session.load("client-test")).toBeUndefined();
  });
});

class ProfileClientForTest {
  #adapter;
  #cache;
  constructor({ fetch_, session, profile }) {
    this.#adapter = new HttpProfileAdapter({ fetch: fetch_, baseUrl: "http://api.local", session, clientContextId: "client-test", timeZone: "UTC" });
    this.#cache = profile;
  }
  cache() {
    return this.#cache;
  }
  async requestRecoveryEmail(email) {
    const [passkey] = this.#cache.passkeys;
    const challenge = await this.#adapter.createPasskeyChallenge("authenticate", passkey.id);
    await this.#adapter.authenticate({ id: passkey.id, challenge: challenge.challenge });
    return this.#adapter.requestRecoveryEmail(email);
  }
}