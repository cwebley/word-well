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
import { databaseConnection, inDatabase } from "../db/connections.mjs";
import { versionedWordLesson, syntheticLesson } from "../src/fixtures/versioned-word-lesson.js";
import { versionedPractice } from "../src/fixtures/versioned-practice.js";

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
let serverTime = testTime;

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
    const learnerPool = new pg.Pool({ connectionString: inDatabase(databaseConnection("learner"), acceptanceDatabase) });
    database = new LearnerDatabase({ pool: learnerPool, now: () => new Date(serverTime) });
    apiServer = createServer(createApi(database));
    await listen(apiServer);
    apiUrl = `http://localhost:${apiServer.address().port}`;
    await exec("npm", ["run", "build"], {
      cwd: root,
      env: { ...process.env, API_BASE_URL: apiUrl },
    });
    siteServer = createServer(serveBuiltSite);
    await listen(siteServer);
    siteUrl = `http://localhost:${siteServer.address().port}`;
    browser = await chromium.launch();
  });

  beforeEach(async () => {
    serverTime = testTime;
    await pool.query("TRUNCATE profile_handoffs, recovery_tokens, passkey_challenges, passkeys, profile_access_events, reserved_upcoming_words, skipped_upcoming_words, learner_evidence, learner_choices, accepted_operations, deliveries, sessions, profiles, published_practice_items, published_lessons");
    await seedPublishedLesson();
  });

  afterAll(async () => {
    await browser?.close();
    await close(siteServer);
    await close(apiServer);
    await database?.close();
    await pool?.end();
    await adminPool?.query(`DROP DATABASE IF EXISTS ${acceptanceDatabase}`);
    await adminPool?.end();
  });

  it("renders the complete lesson and empty Practice bank after a cold offline reload", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);

    await page.getByRole("button", { name: "Completely new to me" }).click();
    await visible(page.getByRole("heading", { name: "candid" }));
    await waitForAcceptedOperations(1);
    await visible(page.getByRole("heading", { name: "Sources and license" }));
    await visible(page.getByText(versionedWordLesson.meanings[0].usageNotes[0].text, { exact: false }));
    await visible(page.getByRole("heading", { name: "Synonym contrasts" }));
    await visible(page.getByRole("heading", { name: "Word family" }));
    await page.getByRole("link", { name: "Practice" }).click();
    await visible(page.getByText("No Practice items are available for recall right now. You can still read your lessons."));
    expect(await page.locator('[data-action="practice-answer"]').count()).toBe(0);

    await context.setOffline(true);
    await page.reload();
    await visible(page.getByRole("heading", { name: "candid" }));
    await page.getByRole("link", { name: "History", exact: true }).click();
    await visible(page.getByText("Words you've met"));
    await page.getByRole("button", { name: "candid", exact: true }).click();
    await visible(page.getByRole("heading", { name: "Sources and license" }));
    await page.getByRole("link", { name: "Practice" }).click();
    await visible(page.getByText("No Practice items are available for recall right now. You can still read your lessons."));
    expect(await page.locator('[data-action="practice-answer"]').count()).toBe(0);
    expect(await acceptedOperationCount()).toBe(1);

    await context.close();
  }, 30_000);

  it("reconciles queued learning through online, manual retry, and foreground restoration", async () => {
    await seedPractice();
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

  it("opens an earlier delivery at current content, then removes withdrawn details and Practice offline", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);
    await page.getByRole("button", { name: "Completely new to me" }).click();
    await waitForAcceptedOperations(1);
    serverTime = new Date("2026-08-29T12:00:00Z");
    await context.addInitScript(value => { globalThis.wordwellTestTime = value; }, serverTime.toISOString());
    await page.evaluate(value => { globalThis.wordwellTestTime = value; }, serverTime.toISOString());
    const replacement = syntheticLesson("lesson-candid", "candid", 2);
    replacement.meanings[0].examples[0] = "The candid replacement appears in earlier history.";
    await pool.query("UPDATE published_lessons SET record = $1 WHERE id = 'lesson-candid'", [replacement]);
    await pool.query("INSERT INTO published_lessons (id, normalized_headword, record) VALUES ($1, $2, $3)",
      ["lesson-lucid", "lucid", syntheticLesson("lesson-lucid", "lucid")]);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await visible(page.getByRole("heading", { name: "lucid" }));
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: "candid", exact: true }).click();
    await visible(page.getByText("The candid replacement appears in earlier history."));
    expect(await page.locator("[data-publication-version]").getAttribute("data-publication-version")).toBe("2");
    await visible(page.getByRole("heading", { name: "Sources and license" }));
    await context.setOffline(true);
    await page.reload();
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: "candid", exact: true }).click();
    await visible(page.getByText("The candid replacement appears in earlier history."));
    expect(await page.locator("[data-publication-version]").getAttribute("data-publication-version")).toBe("2");
    await visible(page.getByRole("heading", { name: "Sources and license" }));
    await visible(page.getByRole("link", { name: "Source revision", exact: true }));
    await context.setOffline(false);
    if (process.env.WORDWELL_ACCEPTANCE_ARTIFACT_DIR)
      await captureRecord(page, "wordwell-current-history-lesson.png", { expandReadingColumn: true });
    await page.getByRole("link", { name: "Practice" }).click();
    await visible(page.getByText("No Practice items are available for recall right now. You can still read your lessons."));
    if (process.env.WORDWELL_ACCEPTANCE_ARTIFACT_DIR)
      await captureRecord(page, "wordwell-empty-practice.png");
    await pool.query("UPDATE published_lessons SET available = false WHERE id = 'lesson-candid'");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => {
      const response = await fetch(`${apiUrl}/learning-state`, { headers: { authorization: `Bearer ${await extractGrant(page)}` } });
      return (await response.json()).state.history.find(item => item.lessonId === "lesson-candid").status;
    }).toBe("unavailable");
    await page.getByRole("link", { name: "History", exact: true }).click();
    await visible(page.getByText("candid", { exact: true }));
    await visible(page.getByText(/Unavailable/));
    expect(await page.getByRole("button", { name: "candid", exact: true }).count()).toBe(0);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole("link", { name: "History", exact: true }).click();
    await visible(page.getByText(/Unavailable/));
    expect(await page.getByRole("button", { name: "candid", exact: true }).count()).toBe(0);
    await page.getByRole("link", { name: "Practice" }).click();
    await visible(page.getByText("No Practice items are available for recall right now. You can still read your lessons."));
    expect(await acceptedOperationCount()).toBe(1);
    await context.close();
  }, 30_000);

  it("removes an already-rendered Practice item on withdrawal and keeps the bank empty after offline reload", async () => {
    await seedPractice();
    const context = await newLearnerContext();
    const page = await openLearner(context);
    await page.getByRole("button", { name: "Completely new to me" }).click();
    await waitForAcceptedOperations(1);
    await page.getByRole("link", { name: "Practice", exact: true }).click();
    await visible(page.getByRole("heading", { name: versionedPractice.prompt }));
    expect(await page.locator('[data-action="practice-answer"]').count()).toBe(2);
    await pool.query("UPDATE published_practice_items SET available = false");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await visible(page.getByText("No Practice items are available for recall right now. You can still read your lessons."));
    expect(await page.locator('[data-action="practice-answer"]').count()).toBe(0);
    await context.setOffline(true);
    await page.reload();
    await page.getByRole("link", { name: "Practice", exact: true }).click();
    await visible(page.getByText("No Practice items are available for recall right now. You can still read your lessons."));
    expect(await page.locator('[data-action="practice-answer"]').count()).toBe(0);
    expect(await acceptedOperationCount()).toBe(1);
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

  it("clears the browser cache and shows the tombstone page after the server deletes the profile", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);

    await page.getByRole("button", { name: "Completely new to me" }).click();
    await visible(page.getByRole("heading", { name: "candid" }));
    await waitForAcceptedOperations(1);
    const grant = await extractGrant(page);
    await authenticateSession(grant);

    const response = await fetch(`${apiUrl}/profile/delete`, {
      method: "POST",
      headers: { authorization: `Bearer ${grant}` },
    });
    expect(response.status).toBe(200);

    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await visible(page.getByRole("heading", { name: "Your WordWell profile is scheduled for permanent deletion." }));

    const stillCached = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const request = indexedDB.open("wordwell", 2);
        request.onsuccess = () => {
          const transaction = request.result.transaction("learner-state", "readonly");
          const operation = transaction.objectStore("learner-state").getAll();
          operation.onsuccess = () => resolve(operation.result);
        };
        request.onerror = () => resolve(null);
      });
    });
    expect(stillCached).toEqual([]);

    await context.close();
  }, 30_000);

  it("rejects later sync attempts with a deleted envelope after the server tombstones the profile", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);

    await page.getByRole("button", { name: "Completely new to me" }).click();
    await visible(page.getByRole("heading", { name: "candid" }));
    await waitForAcceptedOperations(1);
    const grant = await extractGrant(page);
    await authenticateSession(grant);

    await fetch(`${apiUrl}/profile/delete`, {
      method: "POST",
      headers: { authorization: `Bearer ${grant}` },
    });

    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await visible(page.getByRole("heading", { name: "Your WordWell profile is scheduled for permanent deletion." }));

    const lateResponse = await fetch(`${apiUrl}/learning-state/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${grant}`, "content-type": "application/json" },
      body: JSON.stringify({ operations: [] }),
    });
    expect(lateResponse.status).toBe(410);
    expect(await lateResponse.json()).toEqual({ status: "deleted" });

    await context.close();
  }, 30_000);

  it("drains the unsent outbox after the session is renewed while the server was offline", async () => {
    const context = await newLearnerContext();
    const page = await openLearner(context);

    await page.getByRole("button", { name: "Completely new to me" }).click();
    await visible(page.getByRole("heading", { name: "candid" }));
    await waitForAcceptedOperations(1);

    await context.setOffline(true);
    await page.getByRole("button", { name: "Useful to me", exact: true }).click();
    await visible(page.getByRole("button", { name: "Retry" }));

    const grant = await extractGrant(page);
    if (!grant) throw new Error("grant was not found in sessionStorage");
    const renewed = await fetch(`${apiUrl}/session/renew`, {
      method: "POST",
      headers: { authorization: `Bearer ${grant}` },
    });
    const renewedBody = await renewed.json();
    await page.evaluate((nextSession) => {
      const clientId = sessionStorage.getItem("wordwell:client-context");
      sessionStorage.setItem(`wordwell:session:${clientId}`, JSON.stringify(nextSession));
    }, renewedBody.session);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("button", { name: "Retry" }).waitFor({ state: "hidden" });
    await waitForAcceptedOperations(2);

    await context.close();
  }, 30_000);
});

async function extractGrant(page) {
  return page.evaluate(() => {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key && key.startsWith("wordwell:session:")) {
        const value = sessionStorage.getItem(key);
        return value ? JSON.parse(value).grant : null;
      }
    }
    return null;
  });
}

async function authenticateSession(grant) {
  const { createHash } = await import("node:crypto");
  await pool.query(
    "UPDATE sessions SET recently_authenticated_at = $1 WHERE grant_digest = $2",
    [new Date(), createHash("sha256").update(grant).digest("hex")]
  );
}

async function newLearnerContext() {
  const context = await browser.newContext();
  await context.addInitScript((fixedTime) => {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...arguments_) {
        super(...(arguments_.length ? arguments_ : [globalThis.wordwellTestTime ?? fixedTime]));
      }

      static now() {
        return new RealDate(globalThis.wordwellTestTime ?? fixedTime).getTime();
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
  await page.getByRole("button", { name: "Start fresh" }).click();
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
    ["lesson-candid", "candid", versionedWordLesson],
  );
}

async function seedPractice() {
  await pool.query("INSERT INTO published_practice_items (item_id, publication_version, lesson_id, record) VALUES ($1, $2, $3, $4)",
    [versionedPractice.itemId, 1, versionedPractice.lessonId, versionedPractice]);
}

async function captureRecord(page, filename, { expandReadingColumn = false } = {}) {
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === "running"));
  // The app scrolls its reading column rather than the document. Expand that
  // column only for the full-record artifact, then restore the viewport layout.
  const style = expandReadingColumn ? await page.addStyleTag({ content:
    "body.app-page { block-size: auto; overflow: visible; } .app-shell { block-size: auto; } .app-main { overflow-y: visible; }"
  }) : undefined;
  await page.screenshot({ path: path.join(process.env.WORDWELL_ACCEPTANCE_ARTIFACT_DIR, filename), fullPage: true, animations: "disabled" });
  await style?.evaluate(element => element.remove());
}

function databaseUrlFor(database) {
  return inDatabase(databaseUrl, database);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, "localhost", resolve));
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
