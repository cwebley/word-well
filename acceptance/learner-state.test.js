// @vitest-environment node

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pg from "pg";
import { chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LearnerDatabase } from "../api/database.js";
import { createApi } from "../api/http.js";

const exec = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const suite = describe.skipIf(!databaseUrl);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testTime = new Date("2026-08-28T12:00:00Z");

let adminPool;
let pool;
let database;
let apiServer;
let siteServer;
let apiUrl;
let siteUrl;
let browser;
let acceptanceDatabase;

suite("learner-state browser acceptance", () => {
  beforeAll(async () => {
    acceptanceDatabase = `wordwell_acceptance_${process.pid}_${Date.now()}`;
    adminPool = new pg.Pool({ connectionString: databaseUrlFor("postgres") });
    await adminPool.query(`CREATE DATABASE ${acceptanceDatabase}`);
    const isolatedUrl = databaseUrlFor(acceptanceDatabase);
    await exec("npm", ["run", "db:migrate"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: isolatedUrl },
    });

    pool = new pg.Pool({ connectionString: isolatedUrl });
    database = new LearnerDatabase({ pool, now: () => new Date(testTime) });
    apiServer = createServer(createApi(database));
    await listen(apiServer);
    apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
    await exec("npm", ["run", "build"], {
      cwd: root,
      env: { ...process.env, API_BASE_URL: apiUrl },
    });
    siteServer = createServer(serveBuiltSite);
    await listen(siteServer);
    siteUrl = `http://127.0.0.1:${siteServer.address().port}`;
    browser = await chromium.launch();
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE reserved_upcoming_words, skipped_upcoming_words, learner_evidence, learner_choices, accepted_operations, deliveries, sessions, profiles, published_lessons");
    await seedPublishedLesson();
  });

  afterAll(async () => {
    await browser?.close();
    await close(siteServer);
    await close(apiServer);
    await database?.close();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${acceptanceDatabase}`);
    await adminPool?.end();
  });

  it("renders cached lesson, history, and practice after a cold offline reload", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);

    await page.getByRole("button", { name: "Completely new to me" }).click();
    await visible(page.getByRole("heading", { name: "candid" }));
    await waitForAcceptedOperations(1);
    await page.getByRole("link", { name: "Practice" }).click();
    await visible(page.getByRole("heading", { name: "Which sentence uses candid naturally?" }));

    await context.setOffline(true);
    await page.reload();
    await visible(page.getByRole("heading", { name: "candid" }));
    await page.getByRole("link", { name: "History" }).click();
    await visible(page.getByText("Words you've met"));
    await visible(page.getByText("candid").last());
    await page.getByRole("link", { name: "Practice" }).click();
    await visible(page.getByRole("heading", { name: "Which sentence uses candid naturally?" }));

    await context.close();
  }, 30_000);

  it("reconciles queued learning through online, manual retry, and foreground restoration", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);

    await page.route(`${apiUrl}/learning-state/sync`, (route) => route.abort());
    await page.getByRole("button", { name: "Completely new to me" }).click();
    await visible(page.getByRole("button", { name: "Retry" }));
    await page.unroute(`${apiUrl}/learning-state/sync`);
    await page.getByRole("button", { name: "Retry" }).click();
    await waitForAcceptedOperations(1);
    await page.getByRole("link", { name: "Practice" }).click();
    await visible(page.getByRole("heading", { name: "Which sentence uses candid naturally?" }));

    await page.getByRole("link", { name: "Today" }).click();
    await context.setOffline(true);
    await page.getByRole("button", { name: "Useful to me", exact: true }).click();
    await visible(page.getByRole("button", { name: "Retry" }));
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByText("Your changes will sync when you reconnect.").waitFor({ state: "hidden" });
    await waitForAcceptedOperations(2);

    await page.route(`${apiUrl}/learning-state/sync`, (route) => route.abort());
    await page.getByRole("button", { name: "Not useful to me", exact: true }).click();
    await visible(page.getByRole("button", { name: "Retry" }));
    await page.unroute(`${apiUrl}/learning-state/sync`);
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText("Your changes will sync when you reconnect.").waitFor({ state: "hidden" });
    await waitForAcceptedOperations(3);

    await clearIndexedDb(context, page);
    await context.setOffline(true);
    await page.reload();
    await visible(page.locator("#app-main").getByRole("button", { name: "Retry" }));
    await context.setOffline(false);
    await page.locator("#app-main").getByRole("button", { name: "Retry" }).click();
    await visible(page.getByRole("heading", { name: "candid" }));

    await context.close();
  }, 30_000);

  it("keeps cached content and queued changes visible when the server expires its session", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);

    await context.setOffline(true);
    await page.getByRole("button", { name: "Completely new to me" }).click();
    await pool.query("UPDATE sessions SET expires_at = $1", [new Date(testTime.getTime() - 1_000)]);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await visible(page.getByText("Unsent changes remain on this device."));
    await visible(page.getByRole("heading", { name: "candid" }));
    await page.reload();
    await visible(page.getByText("Unsent changes remain on this device."));
    expect(await acceptedOperationCount()).toBe(0);
    await context.close();
  }, 30_000);
});

async function newLearnerContext() {
  const context = await browser.newContext();
  await context.addInitScript((fixedTime) => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...arguments_) {
        super(...(arguments_.length ? arguments_ : [fixedTime]));
      }

      static now() {
        return new RealDate(fixedTime).getTime();
      }
    }
    globalThis.Date = FixedDate;
  }, testTime.toISOString());
  return context;
}

async function openLearner(context) {
  const page = await context.newPage();
  await page.goto(siteUrl);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller);
  await visible(page.getByRole("heading", { name: "candid" }));
  return page;
}

async function visible(locator) {
  await locator.waitFor({ state: "visible" });
  expect(await locator.isVisible()).toBe(true);
}

async function clearIndexedDb(context, page) {
  const client = await context.newCDPSession(page);
  await client.send("Storage.clearDataForOrigin", { origin: siteUrl, storageTypes: "indexeddb" });
  await client.detach();
}

async function seedPublishedLesson() {
  await pool.query(
    "INSERT INTO published_lessons (id, normalized_headword, record) VALUES ($1, $2, $3)",
    ["lesson-candid", "candid", {
      headword: "candid",
      normalizedHeadword: "candid",
      startingBand: "Stretch my vocabulary",
      pronunciation: "KAN-did",
      meanings: [{
        definition: "honest and direct",
        examples: ["Her candid answer clarified the problem."],
        useItWhen: "you are being direct",
        doNotUseItFor: "being cruel",
        synonyms: ["frank"],
        partOfSpeech: "adjective",
        practice: {
          prompt: "Which sentence uses candid naturally?",
          correctSentence: "Her candid answer clarified the problem.",
          incorrectSentence: "The candid chair held four people.",
          explanation: "Candid describes direct honesty.",
        },
      }],
    }],
  );
}

function databaseUrlFor(database) {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return server ? new Promise((resolve) => server.close(resolve)) : undefined;
}

async function serveBuiltSite(request, response) {
  const requestPath = new URL(request.url, "http://wordwell.local").pathname;
  const relativePath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  if (relativePath.includes("..")) {
    response.writeHead(400).end();
    return;
  }
  try {
    const content = await readFile(path.join(root, "dist", relativePath));
    response.writeHead(200, { "content-type": contentType(relativePath) }).end(content);
  } catch {
    response.writeHead(404).end();
  }
}

function contentType(file) {
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".webmanifest")) return "application/manifest+json";
  return "text/html";
}

async function acceptedOperationCount() {
  const result = await pool.query("SELECT count(*)::int AS count FROM accepted_operations");
  return result.rows[0].count;
}

async function waitForAcceptedOperations(expected) {
  await expect.poll(acceptedOperationCount).toBe(expected);
}
