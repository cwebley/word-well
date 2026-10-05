// @vitest-environment node
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createAuthoringStore, loadFrozenDataset, manifestSchema } from "./store.js";
import { content, fixture } from "./fixtures.js";
import { recoverStoppedLock } from "../../pipeline/storage/files.js";
import { withFileLock } from "../../pipeline/storage/files.js";

async function ready(f: Awaited<ReturnType<typeof fixture>>, headword = "exuberant") {
  let workspace = (await f.store.execute({ action: "save", revision: (await f.store.load()).revision, content: content(headword) })).workspace;
  const id = workspace.cases.at(-1)!.id;
  workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id })).workspace;
  workspace = (await f.store.execute({ action: "split", revision: workspace.revision, id, split: "development", beforeInspection: true })).workspace;
  return { workspace, id };
}

describe("private authoring durable workflow", () => {
  it("serializes recovery against a second recovery and a new writer", async () => {
    const f = await fixture();
    try {
      // A reaped child gives a known stopped PID without guessing one.
      const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
      await new Promise<void>(done => child.once("exit", () => done()));
      const path = resolve(f.privateDir, ".write-lock");
      await writeFile(path, JSON.stringify({ schema: "wordwell-local-lock-v1", pid: child.pid }));
      let release!: () => void;
      let paused!: () => void;
      const ready = new Promise<void>(done => { paused = done; });
      const pause = new Promise<void>(done => { release = done; });
      const recovery = recoverStoppedLock(f.privateDir, ".write-lock", async () => { paused(); await pause; });
      await ready;
      await expect(recoverStoppedLock(f.privateDir, ".write-lock")).rejects.toThrow("storage_busy");
      await expect(withFileLock(f.privateDir, ".write-lock", async () => {})).rejects.toThrow("storage_busy");
      release(); await recovery;
      await withFileLock(f.privateDir, ".write-lock", async () => {
        await expect(recoverStoppedLock(f.privateDir, ".write-lock")).rejects.toThrow("lock_owner_running");
        expect((await readFile(path, "utf8")).includes(String(process.pid))).toBe(true);
      });
    } finally { await f.cleanup(); }
  });

  it("survives a killed writer after ciphertext fsync and explicitly recovers its stopped-owner lock", async () => {
    const f = await fixture();
    try {
      const { workspace } = await ready(f);
      const original = await readFile(resolve(f.privateDir, "workspace.age"));
      const child = spawn(process.execPath, ["--import", "tsx", resolve("evals/authoring/interruption-worker.ts")], { stdio: ["pipe", "pipe", "ignore"] });
      const stopped = new Promise<void>(done => child.once("exit", () => done()));
      await new Promise<void>((done, reject) => {
        child.once("error", () => reject(new Error("worker_failed")));
        child.stdout.on("data", bytes => { if (bytes.toString().includes("ciphertext_ready")) done(); });
        child.once("exit", () => reject(new Error("worker_failed")));
        const settings = { privateDir: f.privateDir, checkout: f.checkout, datasetDir: f.datasetDir,
          workspaceId: f.workspaceId, storageKey: f.storageKey, datasetKey: f.datasetKey };
        child.stdin.end(JSON.stringify({ settings, identities: Object.fromEntries(f.identities), revision: workspace.revision }));
      });
      await expect(recoverStoppedLock(f.privateDir, ".write-lock")).rejects.toThrow("lock_owner_running");
      child.kill("SIGKILL"); await stopped;
      expect(await readFile(resolve(f.privateDir, "workspace.age"))).toEqual(original);
      expect((await (await f.reopen()).load()).cases).toEqual(workspace.cases);
      await expect(f.store.execute({ action: "save", revision: workspace.revision, content: content() })).rejects.toThrow("storage_busy");
      await recoverStoppedLock(f.privateDir, ".write-lock");
      await f.store.execute({ action: "save", revision: workspace.revision, content: content("recovered-harmless-marker") });
      for (const name of await readdir(f.privateDir)) {
        const bytes = await readFile(resolve(f.privateDir, name));
        expect(bytes.includes(Buffer.from("harmless-interrupted-marker"))).toBe(false);
      }
    } finally { await f.cleanup(); }
  });

  it("preserves exact input and opaque ID after restart, separates approval, and freezes immutable versions", async () => {
    const f = await fixture();
    try {
      const initial = await f.store.execute({ action: "save", revision: 0, content: content("  Exuberant  ") });
      const row = initial.workspace.cases[0];
      expect(row.approval).toBeNull(); expect(row.split).toBeNull();
      expect((await (await f.reopen()).load()).cases[0]).toEqual(row);
      await expect(f.store.execute({ action: "split", revision: 1, id: row.id, split: "held-out", beforeInspection: true })).rejects.toThrow("approval_required");
      await f.store.execute({ action: "approve", revision: 1, id: row.id });
      await f.store.execute({ action: "split", revision: 2, id: row.id, split: "held-out", beforeInspection: true });
      const first = await f.store.execute({ action: "freeze", revision: 3, version: 1 });
      const directory = resolve(f.datasetDir, "appropriateness-v000001");
      const original = await readFile(resolve(directory, "cases.age"));
      const frozen = await loadFrozenDataset(directory, first.manifest!, f.crypto);
      expect(frozen.cases[0].content.headword).toBe("  Exuberant  ");
      expect(frozen.cases[0].id).toBe(row.id);
      await expect(f.store.execute({ action: "freeze", revision: 3, version: 1 })).rejects.toThrow("version_exists");
      await f.store.execute({ action: "save", revision: 3, id: row.id, content: { ...row.content, finding: "blocked", reason: "harmless-correction-marker" } });
      const changed = (await f.store.load()).cases[0];
      expect(changed.approval).toBeNull(); expect(changed.split).toBeNull();
      await expect(f.store.execute({ action: "freeze", revision: 4, version: 2 })).rejects.toThrow("no_scored_cases");
      await f.store.execute({ action: "approve", revision: 4, id: row.id });
      await f.store.execute({ action: "split", revision: 5, id: row.id, split: "development", beforeInspection: true });
      const second = await f.store.execute({ action: "freeze", revision: 6, version: 2 });
      expect(second.manifest!.id).not.toBe(first.manifest!.id);
      expect(await readFile(resolve(directory, "cases.age"))).toEqual(original);
      expect((await loadFrozenDataset(directory, first.manifest!, f.crypto)).contentIdentity).toBe(frozen.contentIdentity);
      await expect(loadFrozenDataset(directory, second.manifest!, f.crypto)).rejects.toThrow("dataset_selection_mismatch");
      const manifestText = await readFile(resolve(directory, "manifest.json"), "utf8");
      expect(Object.keys(JSON.parse(manifestText)).sort()).toEqual(["ciphertextSha256", "format", "id", "key", "schema", "version"]);
      expect(manifestText).not.toContain(row.content.headword);
      expect(manifestText).not.toContain(row.content.reason);
      expect(manifestText).not.toContain(row.id);
      expect(manifestSchema.safeParse({ ...first.manifest, privateReason: "marker" }).success).toBe(false);
    } finally { await f.cleanup(); }
  });

  it("keeps exploration out, requires preinspection attestation, and keeps connected variants on one side", async () => {
    const f = await fixture();
    try {
      const first = await ready(f, "Exuberant");
      let workspace = (await f.store.execute({ action: "save", revision: first.workspace.revision,
        content: content("exubérant", { variantGroup: randomUUID() }) })).workspace;
      const id = workspace.cases[1].id;
      workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id })).workspace;
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id, split: "held-out", beforeInspection: false })).rejects.toThrow("inspection_attestation_required");
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id, split: "held-out", beforeInspection: true })).rejects.toThrow("variant_split_conflict");
      workspace = (await f.store.execute({ action: "split", revision: workspace.revision, id, split: "development", beforeInspection: true })).workspace;
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, content: content("joyful", { finding: null, reason: "uncertain-marker", firm: false }) })).workspace;
      const uncertain = workspace.cases[2];
      await expect(f.store.execute({ action: "approve", revision: workspace.revision, id: uncertain.id })).rejects.toThrow("firm_label_required");
      const freeze = await f.store.execute({ action: "freeze", revision: workspace.revision, version: 1 });
      expect((await loadFrozenDataset(resolve(f.datasetDir, "appropriateness-v000001"), freeze.manifest!, f.crypto)).cases).toHaveLength(2);
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, content: content("radiant", { answersInspected: true }) })).workspace;
      const inspected = workspace.cases[3];
      workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id: inspected.id })).workspace;
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id: inspected.id, split: "held-out", beforeInspection: true })).rejects.toThrow("heldout_inspected");
      await expect(f.store.execute({ action: "save", revision: workspace.revision, id: inspected.id, content: { ...inspected.content, answersInspected: false } })).rejects.toThrow("inspection_cannot_reset");
    } finally { await f.cleanup(); }
  });

  it("rejects cross-split owner groups including a transitive unassigned bridge", async () => {
    const f = await fixture();
    try {
      let { workspace } = await ready(f, "sunshine");
      const group = workspace.cases[0].content.variantGroup;
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, content: content("sunbeam", { variantGroup: group }) })).workspace;
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, content: content("SUN-BEAM") })).workspace;
      const id = workspace.cases[2].id;
      workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id })).workspace;
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id, split: "held-out", beforeInspection: true })).rejects.toThrow("variant_split_conflict");
    } finally { await f.cleanup(); }
  });

  it("retains inspected input/group history across edits and blocks unassigned inspected variants from held-out", async () => {
    const f = await fixture();
    try {
      let workspace = (await f.store.execute({ action: "save", revision: 0, content: content("sunbeam", { answersInspected: true, firm: false }) })).workspace;
      const inspected = workspace.cases[0];
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, content: content("SUN-BEAM") })).workspace;
      const duplicate = workspace.cases[1];
      workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id: duplicate.id })).workspace;
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id: duplicate.id, split: "held-out", beforeInspection: true })).rejects.toThrow("heldout_inspected_variant");
      // Editing the inspected row's spelling and owner group cannot reset the old input's history.
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, id: inspected.id,
        content: content("radiant", { answersInspected: true, firm: false }) })).workspace;
      expect((await (await f.reopen()).load()).inspectionHistory).toHaveLength(3);
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id: duplicate.id, split: "held-out", beforeInspection: true })).rejects.toThrow("heldout_inspected_variant");
      workspace = (await f.store.execute({ action: "split", revision: workspace.revision, id: duplicate.id, split: "development", beforeInspection: true })).workspace;
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision,
        content: content("sunshine", { variantGroup: inspected.content.variantGroup }) })).workspace;
      const ownerVariant = workspace.cases[2];
      workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id: ownerVariant.id })).workspace;
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id: ownerVariant.id, split: "held-out", beforeInspection: true })).rejects.toThrow("heldout_inspected_variant");
      // An inherited restriction cannot be erased by changing group or the whole input.
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, id: ownerVariant.id,
        content: { ...ownerVariant.content, variantGroup: randomUUID() } })).workspace;
      workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id: ownerVariant.id })).workspace;
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id: ownerVariant.id, split: "held-out", beforeInspection: true })).rejects.toThrow("heldout_inspected_variant");
      const regrouped = workspace.cases[2];
      workspace = (await f.store.execute({ action: "save", revision: workspace.revision, id: ownerVariant.id,
        content: { ...regrouped.content, headword: "sunlit", variantGroup: randomUUID() } })).workspace;
      workspace = (await f.store.execute({ action: "approve", revision: workspace.revision, id: ownerVariant.id })).workspace;
      await expect(f.store.execute({ action: "split", revision: workspace.revision, id: ownerVariant.id, split: "held-out", beforeInspection: true })).rejects.toThrow("heldout_inspected_variant");
      const freeze = await f.store.execute({ action: "freeze", revision: workspace.revision, version: 1 });
      const frozen = await loadFrozenDataset(resolve(f.datasetDir, "appropriateness-v000001"), freeze.manifest!, f.crypto);
      expect(frozen.inspectionHistory).toEqual(workspace.inspectionHistory);
      expect(frozen.cases).toHaveLength(1);
    } finally { await f.cleanup(); }
  });

  it("retains the previous draft on interrupted/failed save, handles unavailable keys, and rejects stale writes", async () => {
    let fail = false;
    const f = await fixture({ beforeDraftRename: async () => { if (fail) throw new Error("harmless-error-marker-SAVE"); } });
    try {
      const { workspace, id } = await ready(f);
      const before = await readFile(resolve(f.privateDir, "workspace.age"));
      fail = true;
      await expect(f.store.execute({ action: "save", revision: workspace.revision, id, content: content("harmless-unsaved-marker") })).rejects.toThrow(/^save_failed$/);
      expect(await readFile(resolve(f.privateDir, "workspace.age"))).toEqual(before);
      expect(await readdir(f.privateDir)).toEqual(["workspace.age"]);
      expect((await (await f.reopen()).load()).cases[0].content.headword).toBe("exuberant");
      fail = false; f.setKeysAvailable(false);
      await expect(f.reopen()).rejects.toThrow(/^key_unavailable$/);
      await expect(f.store.execute({ action: "approve", revision: workspace.revision, id })).rejects.toThrow(/^key_unavailable$/);
      expect(await readFile(resolve(f.privateDir, "workspace.age"))).toEqual(before);
      f.setKeysAvailable(true);
      const results = await Promise.allSettled([0, 1].map(() => f.store.execute({ action: "save", revision: workspace.revision, content: content("concurrent-harmless-marker") })));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      await expect(f.store.execute({ action: "approve", revision: workspace.revision, id })).rejects.toThrow("revision_conflict");
    } finally { await f.cleanup(); }
  });

  it("handles freeze interruption and concurrent conflicts without replacing an existing version", async () => {
    let fail = false;
    const f = await fixture({ beforeFreezeRename: async () => { if (fail) throw new Error("harmless-error-marker-FREEZE"); } });
    try {
      const { workspace } = await ready(f);
      fail = true;
      await expect(f.store.execute({ action: "freeze", revision: workspace.revision, version: 1 })).rejects.toThrow(/^freeze_failed$/);
      expect(await readdir(f.datasetDir)).toEqual([]);
      fail = false;
      const otherStore = await f.reopen();
      const results = await Promise.allSettled([f.store, otherStore].map(store => store.execute({ action: "freeze", revision: workspace.revision, version: 1 })));
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const original = await readFile(resolve(f.datasetDir, "appropriateness-v000001/cases.age"));
      await expect(f.store.execute({ action: "freeze", revision: workspace.revision, version: 1 })).rejects.toThrow("version_exists");
      expect(await readFile(resolve(f.datasetDir, "appropriateness-v000001/cases.age"))).toEqual(original);
    } finally { await f.cleanup(); }
  });

  it("rejects tampered dataset identity and embedded draft identity, and prevents checkout draft storage", async () => {
    const f = await fixture();
    try {
      const { workspace } = await ready(f);
      const frozen = await f.store.execute({ action: "freeze", revision: workspace.revision, version: 1 });
      const directory = resolve(f.datasetDir, "appropriateness-v000001");
      const loaded = await loadFrozenDataset(directory, frozen.manifest!, f.crypto);
      const altered = await f.crypto.encrypt(f.datasetKey, loaded.id, { ...loaded, cases: [{ ...loaded.cases[0], content: content("tampered-harmless-marker") }] });
      await writeFile(resolve(directory, "cases.age"), altered);
      await expect(loadFrozenDataset(directory, frozen.manifest!, f.crypto)).rejects.toThrow("ciphertext_mismatch");
      const { digest } = await import("../../pipeline/storage/crypto.js");
      const changedManifest = { ...frozen.manifest!, ciphertextSha256: digest(altered) };
      await writeFile(resolve(directory, "manifest.json"), JSON.stringify(changedManifest));
      await expect(loadFrozenDataset(directory, changedManifest, f.crypto)).rejects.toThrow("dataset_identity_mismatch");
      await writeFile(resolve(f.privateDir, "workspace.age"), await f.crypto.encrypt(f.storageKey, randomUUID(), workspace));
      await expect(f.reopen()).rejects.toThrow("record_invalid");
      await expect(createAuthoringStore({ ...f, privateDir: resolve(f.checkout, "private") })).rejects.toThrow("private_path_in_checkout");
    } finally { await f.cleanup(); }
  });
});
