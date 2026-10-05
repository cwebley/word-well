// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { fixture } from "./fixtures.js";
import { startAuthoringServer } from "./server.js";
import { loadFrozenDataset, manifestSchema } from "./store.js";

async function click(page: Page, name: string) {
  const [response] = await Promise.all([page.waitForNavigation(), page.getByRole("button", { name, exact: true }).click()]);
  if (response && response.status() >= 400 && response.status() !== 409)
    throw new Error(`browser_http_${response.status()}`);
}

async function leakScan(directory: string, markers: string[]): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    expect(markers.every(marker => !entry.name.includes(marker))).toBe(true);
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await leakScan(path, markers);
    else {
      const bytes = await readFile(path);
      expect(markers.every(marker => !bytes.includes(Buffer.from(marker)))).toBe(true);
      expect(bytes.includes(Buffer.from("AGE-SECRET-KEY-"))).toBe(false);
    }
  }
}

describe("actual private authoring browser", () => {
  it("edits exploration into a firm label on the same case and allows correction after approval", async () => {
    const f = await fixture();
    const server = await startAuthoringServer(f.store);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(server.url);
      await page.getByLabel("Exact headword").fill("harmless-exploration-marker");
      await page.getByLabel("Expected finding").selectOption("clear");
      await click(page, "Save encrypted draft");
      const original = (await f.store.load()).cases[0];
      expect(original.content.firm).toBe(false);
      expect(await page.getByRole("button", { name: "Approve current saved content" }).count()).toBe(0);
      await expect(f.store.execute({ action: "approve", revision: 1, id: original.id })).rejects.toThrow("firm_label_required");

      await page.getByRole("link", { name: "Edit case", exact: true }).click();
      expect(await page.getByLabel("Exact headword").inputValue()).toBe("harmless-exploration-marker");
      await page.getByLabel("This is a firm owner label", { exact: false }).check();
      await click(page, "Save case changes");
      const firm = (await f.store.load()).cases;
      expect(firm).toHaveLength(1);
      expect(firm[0].id).toBe(original.id);
      expect(firm[0].content.firm).toBe(true);
      await click(page, "Approve current saved content");
      expect((await f.store.load()).cases[0].approval).not.toBeNull();

      await page.locator('article select[name="split"]').selectOption("development");
      await page.getByLabel("I am assigning this before", { exact: false }).check();
      await click(page, "Save split assignment");
      await page.getByRole("link", { name: "Edit case", exact: true }).click();
      await page.getByLabel("This is a firm owner label", { exact: false }).uncheck();
      await click(page, "Save case changes");
      const corrected = (await f.store.load()).cases[0];
      expect(corrected.id).toBe(original.id);
      expect(corrected.content.firm).toBe(false);
      expect(corrected.approval).toBeNull();
      expect(corrected.split).toBeNull();
      expect(await page.getByRole("button", { name: "Approve current saved content" }).count()).toBe(0);
      await leakScan(f.root, ["harmless-exploration-marker"]);
    } finally { await browser?.close(); await server.close(); await f.cleanup(); }
  }, 15_000);

  it("requires a finding but saves, approves, assigns and freezes firm cases without a reason", async () => {
    const f = await fixture();
    const server = await startAuthoringServer(f.store);
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(server.url);
      await page.getByLabel("Exact headword").fill("harmless-validation-marker");
      await page.getByLabel("This is a firm owner label", { exact: false }).check();
      await click(page, "Save encrypted draft");
      expect(await page.locator("#notice").textContent()).toBe("Draft not saved. Choose an expected finding for a firm owner label, then save again.");
      expect(await page.getByLabel("Exact headword").inputValue()).toBe("harmless-validation-marker");
      expect(await page.getByLabel("Short reason").inputValue()).toBe("");
      expect((await f.store.load()).revision).toBe(0);
      expect(await readdir(f.privateDir)).toEqual([]);

      await page.getByLabel("Expected finding").selectOption("blocked");
      await click(page, "Save encrypted draft");
      expect(await page.locator("#notice").textContent()).toContain("Draft saved encrypted");
      expect((await f.store.load()).cases).toHaveLength(1);
      await click(page, "Approve current saved content");
      await page.locator('article select[name="split"]').selectOption("development");
      await page.getByLabel("I am assigning this before", { exact: false }).check();
      await click(page, "Save split assignment");
      await page.getByLabel("I reviewed the scored membership", { exact: false }).check();
      await click(page, "Freeze encrypted dataset");
      expect(await page.locator("#notice").textContent()).toContain("version 1 frozen");
      const directory = resolve(f.datasetDir, "appropriateness-v000001");
      const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8")));
      const frozen = await loadFrozenDataset(directory, manifest, f.crypto);
      expect(frozen.cases[0].content.reason).toBe("");
      expect(frozen.cases[0].approval).not.toBeNull();
      expect(frozen.cases[0].split).toBe("development");
      await leakScan(f.root, ["harmless-validation-marker"]);
    } finally { await browser?.close(); await server.close(); await f.cleanup(); }
  }, 15_000);

  it("enters, encrypts, approves, assigns, restarts, corrects and freezes without leaks or outbound resources", async () => {
    let failSave = false;
    const f = await fixture({ beforeDraftRename: async () => { if (failSave) throw new Error("harmless-error-marker-BROWSER"); } });
    let server = await startAuthoringServer(f.store);
    let browser: Browser | undefined;
    const marker = "harmless-browser-reason-marker";
    const source = "harmless-browser-source-marker";
    const word = "harmless-browser-headword-marker";
    const unsaved = "harmless-browser-unsaved-marker";
    const events: string[] = [];
    const destinations: string[] = [];
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on("console", message => events.push(message.text()));
      page.on("pageerror", error => events.push(error.message));
      context.on("request", request => destinations.push(request.url()));
      await page.goto(server.url);
      expect(await page.locator('select[name="finding"]').inputValue()).toBe("");
      const response = await page.reload();
      expect(response!.headers()["cache-control"]).toContain("no-store");
      expect(response!.headers()["content-security-policy"]).toContain("default-src 'none'");
      await page.getByLabel("Exact headword").fill("exuberant");
      await page.getByLabel("Expected finding").selectOption("clear");
      await page.getByLabel("Short reason").fill(`${marker} <img src="https://example.invalid/leak" onerror="alert(1)">`);
      await page.getByLabel("This is a firm owner label", { exact: false }).check();
      await page.getByLabel("Private nomination", { exact: false }).fill(source);
      await click(page, "Save encrypted draft");
      expect(await page.locator("#notice").textContent()).toContain("Draft saved encrypted");
      expect(await page.locator("article").textContent()).toContain("Not approved");
      expect(await page.locator("article img").count()).toBe(0);
      await click(page, "Approve current saved content");
      await page.locator('article select[name="split"]').selectOption("development");
      await page.getByLabel("I am assigning this before", { exact: false }).check();
      await click(page, "Save split assignment");
      expect(await page.locator("#coverage").textContent()).toContain("Development: 1 clear");
      const initialId = (await f.store.load()).cases[0].id;

      // New process-memory state and browser session. Old session cannot read it.
      const oldOrigin = server.origin;
      await server.close();
      server = await startAuthoringServer(await f.reopen());
      await page.goto(server.url);
      expect(await page.locator("article").textContent()).toContain("Owner-approved");
      expect((await f.store.load()).cases[0].id).toBe(initialId);
      expect(server.origin).not.toBe(oldOrigin);

      await page.getByLabel("Exact headword").fill(word);
      await page.getByLabel("Expected finding").selectOption("blocked");
      await page.getByLabel("Short reason").fill("Synthetic blocked expectation for workflow testing only.");
      await page.getByLabel("This is a firm owner label", { exact: false }).check();
      await click(page, "Save encrypted draft");
      const second = page.locator("article").filter({ has: page.getByRole("link", { name: word, exact: true }) });
      await Promise.all([page.waitForNavigation(), second.getByRole("button", { name: "Approve current saved content" }).click()]);
      await second.locator('select[name="split"]').selectOption("held-out");
      await second.getByLabel("I am assigning this before", { exact: false }).check();
      await Promise.all([page.waitForNavigation(), second.getByRole("button", { name: "Save split assignment" }).click()]);
      expect(await page.locator("#coverage").textContent()).toContain("Held-out: 0 clear, 1 blocked");

      await page.getByLabel("I reviewed the scored membership", { exact: false }).check();
      await click(page, "Freeze encrypted dataset");
      expect(await page.locator("#notice").textContent()).toContain("version 1 frozen");
      const datasetPath = resolve(f.datasetDir, "appropriateness-v000001");
      const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(datasetPath, "manifest.json"), "utf8")));
      const firstBytes = await readFile(resolve(datasetPath, "cases.age"));
      const first = await loadFrozenDataset(datasetPath, manifest, f.crypto);
      expect(first.cases).toHaveLength(2);

      await page.getByRole("link", { name: "exuberant", exact: true }).click();
      await page.getByLabel("Short reason").fill(`${marker} correction`);
      await click(page, "Save case changes");
      expect((await f.store.load()).cases.find(row => row.id === initialId)!.approval).toBeNull();
      expect(await page.locator("#coverage").textContent()).toContain("Development: 0 clear");
      const firstArticle = page.locator("article").filter({ has: page.getByRole("link", { name: "exuberant", exact: true }) });
      await Promise.all([page.waitForNavigation(), firstArticle.getByRole("button", { name: "Approve current saved content" }).click()]);
      await firstArticle.locator('select[name="split"]').selectOption("development");
      await firstArticle.getByLabel("I am assigning this before", { exact: false }).check();
      await Promise.all([page.waitForNavigation(), firstArticle.getByRole("button", { name: "Save split assignment" }).click()]);
      await page.getByLabel("I reviewed the scored membership", { exact: false }).check();
      await click(page, "Freeze encrypted dataset");
      expect(await page.locator("#notice").textContent()).toContain("version 2 frozen");
      expect(await readFile(resolve(datasetPath, "cases.age"))).toEqual(firstBytes);

      // The server must retain the unsaved form, never claim success or print the error.
      failSave = true;
      await page.getByLabel("Exact headword").fill(unsaved);
      await page.getByLabel("Short reason").fill("harmless-unsaved-reason-marker");
      await click(page, "Save encrypted draft");
      expect(await page.locator("#notice").textContent()).toContain("Not confirmed saved. save_failed");
      expect(await page.getByLabel("Exact headword").inputValue()).toBe(unsaved);
      expect((await f.store.load()).cases).toHaveLength(2);
      failSave = false;

      const persistent = await page.evaluate(async () => ({
        local: localStorage.length, session: sessionStorage.length,
        // The pipeline project intentionally excludes DOM types.
        databases: (await (globalThis as unknown as { indexedDB: { databases(): Promise<unknown[]> } }).indexedDB.databases()).length,
        caches: (await (globalThis as unknown as { caches: { keys(): Promise<string[]> } }).caches.keys()).length,
        workers: (await (navigator as unknown as { serviceWorker: { getRegistrations(): Promise<unknown[]> } }).serviceWorker.getRegistrations()).length
      }));
      expect(persistent).toEqual({ local: 0, session: 0, databases: 0, caches: 0, workers: 0 });
      const cookies = await context.cookies();
      expect(cookies.every(cookie => cookie.name === "ww-authoring" && cookie.httpOnly && cookie.expires === -1)).toBe(true);
      expect(events.every(value => value === "Failed to load resource: the server responded with a status of 409 (Conflict)")).toBe(true);
      expect(destinations.every(url => new URL(url).hostname === "127.0.0.1")).toBe(true);
      await leakScan(f.root, [marker, source, word, unsaved, "harmless-error-marker-BROWSER", "harmless-unsaved-reason-marker"]);

      // A key failure does not expose the saved cases or echo diagnostics.
      f.setKeysAvailable(false);
      await page.reload();
      expect(await page.locator("body").textContent()).toBe("key_unavailable");
      expect(events.every(value => !value.includes(marker))).toBe(true);
    } finally { await browser?.close(); await server.close(); await f.cleanup(); }
  }, 30_000);

  it("rejects absent sessions, cross-origin writes, invalid CSRF, DNS-rebinding Host and stale forms", async () => {
    const f = await fixture(); const server = await startAuthoringServer(f.store);
    try {
      expect((await fetch(server.origin)).status).toBe(403);
      expect((await fetch(server.url, { headers: { Host: "attacker.invalid" } })).status).toBe(403);
      expect((await fetch(server.url, { headers: { "Sec-Fetch-Site": "cross-site" } })).status).toBe(403);
      const login = await fetch(server.url, { redirect: "manual" });
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const page = await fetch(server.origin, { headers: { Cookie: cookie } });
      const html = await page.text();
      const csrf = /name="csrf" value="([a-f0-9]+)"/.exec(html)![1];
      const request = (origin: string, token: string, revision = "0") => fetch(server.origin + "/action", {
        method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ action: "save", csrf: token, revision, headword: "harmless-request-marker", finding: "", reason: "", provenance: "", variantGroup: "" })
      });
      expect((await request("http://attacker.invalid", csrf)).status).toBe(403);
      expect((await request(server.origin, "wrong-token")).status).toBe(403);
      expect((await f.store.load()).revision).toBe(0);
      expect((await request(server.origin, csrf)).status).toBe(200);
      const stale = await request(server.origin, csrf);
      expect(stale.status).toBe(409);
      expect(await stale.text()).toContain("revision_conflict");
      expect((await f.store.load()).cases).toHaveLength(1);
    } finally { await server.close(); await f.cleanup(); }
  });

  it.skipIf(process.env.WORDWELL_TEST_KEYCHAIN !== "1")("uses actual versioned Keychain keys and reopens after a CLI process restart", async () => {
    const f = await fixture();
    let browser: Browser | undefined;
    let child: ChildProcess | undefined;
    const entry = resolve("evals/private-authoring.ts");
    const start = () => new Promise<string>((resolveUrl, reject) => {
      child = spawn(process.execPath, ["--import", "tsx", entry, "start", "--private-dir", f.privateDir], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout!.on("data", data => {
        output += data.toString();
        const match = /http:\/\/127\.0\.0\.1:[0-9]+\/session\/[a-f0-9]+/.exec(output);
        if (match) resolveUrl(match[0]);
      });
      child.once("error", () => reject(new Error("cli_start_failed")));
      child.once("exit", () => reject(new Error("cli_start_failed")));
    });
    const stop = () => new Promise<void>(done => { child!.once("exit", () => done()); child!.kill("SIGTERM"); });
    try {
      // Explicit setup provisions/reuses the dedicated identities. No key output.
      await new Promise<void>((done, reject) => {
        const setup = spawn(process.execPath, ["--import", "tsx", entry, "setup", "--private-dir", f.privateDir], { stdio: "ignore" });
        setup.once("error", () => reject(new Error("setup_failed")));
        setup.once("exit", code => code === 0 ? done() : reject(new Error("setup_failed")));
      });
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(await start());
      await page.getByLabel("Exact headword").fill("exuberant");
      await page.getByLabel("Short reason").fill("harmless-keychain-restart-marker");
      await click(page, "Save encrypted draft");
      expect(await page.locator("#notice").textContent()).toContain("Draft saved encrypted");
      await stop();
      await page.goto(await start());
      expect(await page.locator("article").textContent()).toContain("harmless-keychain-restart-marker");
      expect(await page.locator("article").textContent()).toContain("Exploration");
      await leakScan(f.privateDir, ["exuberant", "harmless-keychain-restart-marker"]);
      await stop(); child = undefined;
    } finally {
      child?.kill("SIGKILL"); await browser?.close();
      await rm(f.root, { force: true, recursive: true });
    }
  }, 120_000);
});
