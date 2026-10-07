// @vitest-environment node
import { expect, it } from "vitest";
import { lookupLunaRouting } from "./luna-response.js";

it.each(["network", 524, 529])("retries transient metadata failure %s without generation", async failure => {
  let reads = 0, clock = 0;
  const sleeps: number[] = [];
  const result = await lookupLunaRouting({ generationId: "gen-harmless", apiKey: "harmless-key", now: () => clock,
    sleep: async ms => { sleeps.push(ms); clock += ms; }, fetch: async (url, options) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/generation?id=gen-harmless");
      expect(options?.method ?? "GET").toBe("GET");
      if (++reads === 1) {
        if (failure === "network") throw new Error("controlled-network-failure");
        return new Response("busy", { status: Number(failure) });
      }
      return new Response("available");
    } });
  expect(reads).toBe(2);
  expect(sleeps).toEqual([1000]);
  expect(result.routing).toMatchObject({ status: 200, body: "available" });
  expect(result.lookups.map(r => r.body)).toEqual(failure === "network" ? ["available"] : ["busy", "available"]);
});

it("bounds repeated network failures and honors a Retry-After beyond the lookup deadline", async () => {
  let reads = 0, clock = 0;
  const result = await lookupLunaRouting({ generationId: "gen-harmless", apiKey: "harmless-key", now: () => clock,
    sleep: async ms => { clock += ms; }, fetch: async () => { reads++; throw new Error("controlled-network-failure"); } });
  expect(reads).toBe(6);
  expect(clock).toBe(23000);
  expect(result.routing).toBeNull();
  reads = 0;
  const deferred = await lookupLunaRouting({ generationId: "gen-harmless", apiKey: "harmless-key", now: () => clock,
    sleep: async () => { throw new Error("must-not-sleep"); }, fetch: async () => { reads++; return new Response("busy", { status: 429, headers: { "retry-after": "60" } }); } });
  expect(reads).toBe(1);
  expect(deferred.routing?.status).toBe(429);
});

it("retains Retry-After when the metadata response body disconnects", async () => {
  let reads = 0;
  const result = await lookupLunaRouting({ generationId: "gen-harmless", apiKey: "harmless-key", now: () => 0,
    sleep: async () => { throw new Error("must-not-sleep-before-provider-cooldown"); }, fetch: async () => {
      reads++;
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error("controlled-body-disconnection")); } }),
        { status: 429, headers: { "retry-after": "60" } });
    } });
  expect(reads).toBe(1);
  expect(result).toMatchObject({ attempts: 1, lookups: [], routing: null, nextEligibleAt: "1970-01-01T00:01:00.000Z" });
});
