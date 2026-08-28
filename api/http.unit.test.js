import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "./http.js";

let server;
let baseUrl;

beforeAll(async () => {
  const database = {
    createAnonymousProfile: async () => ({ profile: { state: "anonymous" }, session: { grant: "grant", expiresAt: "2026-09-26T12:00:00.000Z" } }),
    readState: async () => ({ status: "active", state: { lessons: [], history: [], evidence: [], mutable: [] } }),
    synchronize: async (_grant, operations) => ({ status: "active", state: { lessons: [], history: [], evidence: operations, mutable: [] } }),
    renewSession: async () => ({ status: "session-expired" })
  };
  server = createServer(createApi(database));
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("HTTP learner sync contract", () => {
  it("maps profile creation and canonical state to JSON responses", async () => {
    const created = await request("POST", "/profiles/anonymous");
    const state = await request("GET", "/learning-state");

    expect(created.response.status).toBe(201);
    expect(created.body.profile).toEqual({ state: "anonymous" });
    expect(state.response.status).toBe(200);
    expect(state.body.status).toBe("active");
  });

  it("rejects malformed or oversized sync batches before dispatch", async () => {
    const malformed = await request("POST", "/learning-state/sync", { operations: [{ kind: "practice" }] });
    const oversized = await request("POST", "/learning-state/sync", { operations: Array.from({ length: 101 }, () => ({})) });

    expect(malformed.response.status).toBe(400);
    expect(oversized.response.status).toBe(400);
  });

  it("uses the session-expired response for missing credentials", async () => {
    const response = await fetch(`${baseUrl}/learning-state`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ status: "session-expired" });
  });
});

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: "Bearer grant", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { response, body: await response.json() };
}
