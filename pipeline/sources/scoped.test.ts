// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import pg from "pg";
import { executeSourceCommand } from "../commands.js";
import { createSourceStore, SOURCE_TABLES } from "../storage/sources.js";
import { harmlessKeys, testDatabase } from "../testing/private-fixtures.js";
import { loadPipelineConfig } from "../config.js";
import { bundleFilterInput, evaluateFilters, generationEvidence } from "../intake.js";
import { intakeConfigurationIdentity, authorizeScopedCandidate } from "./index.js";
import { z } from "zod";

describe.skipIf(!process.env.DATABASE_URL)("real scoped operator commands", () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let keys: Awaited<ReturnType<typeof harmlessKeys>>;
  let admin: pg.Pool, learner: pg.Pool, pipeline: pg.Pool;
  let temp: string, bundleId: string;
  const openStore = () => createSourceStore({ connectionString: database.pipelineUrl, storageKey: keys.storageKey, crypto: keys.crypto });
  beforeAll(async () => {
    database = await testDatabase(); keys = await harmlessKeys();
    admin = new pg.Pool({ connectionString: database.adminUrl }); learner = new pg.Pool({ connectionString: database.learnerUrl }); pipeline = new pg.Pool({ connectionString: database.pipelineUrl });
    temp = await mkdtemp(resolve(tmpdir(), "wordwell-scoped-test-"));
  }, 30_000);
  afterAll(async () => {
    await Promise.all([admin?.end(), learner?.end(), pipeline?.end()]);
    if (database) await database.drop();
    if (temp) await rm(temp, { recursive: true, force: true });
  });
  it("commits bounded progress, resumes, retains the real whole records and explains intake", async () => {
    const first = await executeSourceCommand(["sources", "import", "--limit", "1"], openStore);
    expect(first).toMatchObject({ status: "loading", checkpoint: 1, modelCalls: 0 });
    bundleId = z.object({ bundleId: z.string() }).parse(first).bundleId;
    await expect(executeSourceCommand(["candidate", "explain", "emulate", "--bundle", bundleId], openStore)).rejects.toThrow("selected_bundle_not_ready");
    expect(await executeSourceCommand(["sources", "import"], openStore)).toMatchObject({ status: "ready", bundleId, reused: false, modelCalls: 0 });
    expect(await executeSourceCommand(["candidates", "build", "--bundle", bundleId], openStore)).toMatchObject({ disposition: "pass", modelCalls: 0 });
    const explanation = await executeSourceCommand(["candidate", "explain", "emulate", "--bundle", bundleId], openStore);
    expect(explanation).toMatchObject({ coverage: { candidates: ["emulate"], fullCorpus: false, oewnMeanings: 3, kaikkiMeanings: 5 }, assessment: { disposition: "pass", gateVerdict: null } });
    const store = await openStore();
    try {
      const evidence = await store.readyBundle(bundleId);
      expect(evidence.meanings.filter(m => m.source === "oewn" && m.entryId === "oewn-emulate-v").map(m => m.id)).toEqual(["oewn-emulate__2.42.00..", "oewn-emulate__2.42.01..", "oewn-emulate__2.33.00.."]);
      expect(evidence.meanings.filter(m => m.source === "kaikki")).toHaveLength(5);
      expect(evidence.entries.filter(e => e.source === "kaikki").map(e => e.order)).toEqual([34324, 34325]);
      expect(evidence.entries.find(e => e.id === "line:34324")?.raw).toContain('"type": "quotation"');
      expect(evidence.supplemental.meanings[0].qualifiers[0].arguments).toEqual(["en", "now", "_", "rare"]);
      expect(evidence.supplemental.authenticatesKaikki).toBe(false);
      expect(evidence.meanings.find(m => m.id === "line:34324:meaning:1")?.data.tags).toContain("archaic");
      expect(evidence.frequency).toMatchObject({ form: "emulate", order: 16960, directZipf: 3.41, storedFrequency: 0.0000025703957827688647 });
      expect(new Set(evidence.relations.filter(r => r.source === "kaikki").map(r => r.word)).size).toBe(7);
      expect(evidence.relations.filter(r => r.purpose === "contrast").map(r => r.word)).toEqual(expect.arrayContaining(["copy", "imitate", "simulate", "compete", "vie", "contend"]));
      const input = bundleFilterInput(evidence);
      expect(input.labels).toEqual(expect.arrayContaining([expect.objectContaining({ value: "obsolete" }), expect.objectContaining({ value: "now rare" })]));
      const config = await loadPipelineConfig("config/pipeline.yaml");
      expect(await authorizeScopedCandidate(store, bundleId, config)).toMatchObject({ headword: "emulate", appropriatenessInput: { headword: "emulate" } });
      config.filters.frequency.ceiling = 3.4;
      const changed = await store.assess({ bundleId, headword: "emulate", configFingerprint: await intakeConfigurationIdentity(config), resolution: input.resolution,
        assessment: { ...evaluateFilters(input, config), effectiveConfiguration: config } });
      expect(changed.disposition).toBe("exclude");
      await expect(authorizeScopedCandidate(store, bundleId, config)).rejects.toThrow("candidate_intake_not_passing");
      expect((await store.explanation(bundleId, "emulate", await intakeConfigurationIdentity(await loadPipelineConfig("config/pipeline.yaml")))).assessment.disposition).toBe("pass");
    } finally { await store.close(); }
    const saved = (await pipeline.query("SELECT payload FROM private.intake_candidates")).rows[0].payload;
    expect(saved.toString()).not.toContain("emulate");
    for (const table of SOURCE_TABLES) await expect(learner.query(`SELECT * FROM private.${table}`)).rejects.toMatchObject({ code: "42501" });
    await expect(pipeline.query("UPDATE private.source_entries SET headword='changed' WHERE bundle_id=$1", [bundleId])).rejects.toMatchObject({ code: "55000" });
    await expect(pipeline.query("UPDATE private.source_bundles SET status='failed' WHERE id=$1", [bundleId])).rejects.toMatchObject({ code: "55000" });
    await expect(pipeline.query("CREATE TABLE private.forbidden_fixture(id integer)")).rejects.toMatchObject({ code: "42501" });
  }, 180_000);
  it("reuses unchanged imports without duplicate evidence or candidates", async () => {
    const counts = async () => (await pipeline.query("SELECT (SELECT count(*) FROM private.source_entries) AS entries, (SELECT count(*) FROM private.source_meanings) AS meanings, (SELECT count(*) FROM private.intake_candidates) AS candidates, (SELECT count(*) FROM private.intake_assessments) AS assessments")).rows[0];
    const before = await counts();
    expect(await executeSourceCommand(["sources", "import"], openStore)).toMatchObject({ bundleId, status: "ready", reused: true });
    await executeSourceCommand(["candidates", "build", "--bundle", bundleId], openStore);
    expect(await counts()).toEqual(before);
    await expect(executeSourceCommand(["candidate", "explain", "emulate"], openStore)).rejects.toThrow("explicit_bundle_required");
  }, 120_000);
  it("rolls back an interrupted unit and resumes committed progress", async () => {
    const store = await openStore();
    const evidence = await store.readyBundle(bundleId);
    const interruptionId = "a".repeat(64);
    let failed = false;
    try {
      await expect(store.importBundle({ id: interruptionId, intention: { controlledInterruption: true }, load: async () => evidence,
        beforeUnit: async index => { if (index === 18 && !failed) { failed = true; throw new Error("controlled_interruption"); } } })).rejects.toThrow("source_storage_unavailable");
      expect((await pipeline.query("SELECT status,checkpoint FROM private.source_bundles WHERE id=$1", [interruptionId])).rows[0]).toMatchObject({ status: "failed", checkpoint: 18 });
      expect(await store.importBundle({ id: interruptionId, intention: { controlledInterruption: true }, load: async () => evidence })).toMatchObject({ status: "ready" });
      expect((await pipeline.query("SELECT count(*) FROM private.source_entries WHERE bundle_id=$1", [interruptionId])).rows[0].count).toBe(String(evidence.entries.length));
    } finally { await store.close(); }
  }, 30_000);
  it("retains a failed changed-input bundle without selecting or modifying earlier ready evidence", async () => {
    const scope = JSON.parse(await readFile("config/emulate-scope.json", "utf8"));
    scope.mappingVersion = "controlled-missing-required-v2";
    scope.supplemental.textSha256 = "0".repeat(64);
    const scopePath = resolve(temp, "missing-required.json");
    await writeFile(scopePath, JSON.stringify(scope));
    await expect(executeSourceCommand(["sources", "import", "--scope", scopePath], openStore)).rejects.toThrow("scoped_supplemental_page_changed");
    expect((await pipeline.query("SELECT count(*) FROM private.source_bundles WHERE status='failed'")).rows[0].count).toBe("1");
    expect((await pipeline.query("SELECT error_code FROM private.source_import_attempts WHERE status='failed' ORDER BY created_at DESC LIMIT 1")).rows[0].error_code).toBe("scoped_supplemental_page_changed");
    expect(await executeSourceCommand(["candidate", "explain", "emulate", "--bundle", bundleId], openStore)).toMatchObject({ assessment: { disposition: "pass" } });
    expect((await pipeline.query("SELECT count(*) FROM private.intake_assessments")).rows[0].count).toBe("2");
  }, 120_000);
  it("checks corrupt artifact bytes on repeat and keeps ready evidence usable", async () => {
    const root = resolve(temp, "corrupt-source");
    await mkdir(resolve(root, "downloads"), { recursive: true });
    await writeFile(resolve(root, "downloads/english-wordnet-2025.xml.gz"), "controlled-corrupt-artifact");
    await expect(executeSourceCommand(["sources", "import", "--directory", root], openStore)).rejects.toThrow("scoped_artifact_changed");
    expect((await pipeline.query("SELECT status FROM private.source_bundles WHERE id=$1", [bundleId])).rows[0].status).toBe("ready");
    expect(await executeSourceCommand(["candidate", "explain", "emulate", "--bundle", bundleId], openStore)).toMatchObject({ assessment: { disposition: "pass" } });
  }, 30_000);
  it("creates a separate ready bundle for changed mappings and preserves candidate identity", async () => {
    const scope = JSON.parse(await readFile("config/emulate-scope.json", "utf8"));
    scope.mappingVersion = "controlled-new-mapping-v2";
    const scopePath = resolve(temp, "changed-mapping.json");
    await writeFile(scopePath, JSON.stringify(scope));
    const changed = z.object({ bundleId: z.string(), status: z.literal("ready") }).parse(await executeSourceCommand(["sources", "import", "--scope", scopePath], openStore));
    expect(changed.bundleId).not.toBe(bundleId);
    await executeSourceCommand(["candidates", "build", "--bundle", changed.bundleId], openStore);
    const original = z.object({ candidateId: z.string(), lessonId: z.string() }).parse(await executeSourceCommand(["candidate", "explain", "emulate", "--bundle", bundleId], openStore));
    const updated = z.object({ candidateId: z.string(), lessonId: z.string() }).parse(await executeSourceCommand(["candidate", "explain", "emulate", "--bundle", changed.bundleId], openStore));
    expect(updated).toEqual(original);
    expect((await pipeline.query("SELECT count(*) FROM private.intake_candidates")).rows[0].count).toBe("1");
  }, 120_000);
  it("imports evanescent separately, preserves nested evidence and authorizes only its recorded OEWN subject", async () => {
    const args = ["sources", "import", "--scope", "config/evanescent-scope.json"];
    const first = z.object({ bundleId: z.string() }).parse(await executeSourceCommand([...args, "--limit", "1"], openStore));
    expect(first.bundleId).not.toBe(bundleId);
    const store = await openStore();
    try {
      await expect(store.readyBundle(first.bundleId)).rejects.toThrow("selected_bundle_not_ready");
      expect(await executeSourceCommand(args, openStore)).toMatchObject({ bundleId: first.bundleId, status: "ready", reused: false });
      const evanescent = await store.readyBundle(first.bundleId), emulate = await store.readyBundle(bundleId);
      expect(evanescent.coverage).toEqual({ candidates: ["evanescent"], fullCorpus: false, oewnMeanings: 1, kaikkiMeanings: 6 });
      expect(evanescent.entries.filter(e => e.source === "kaikki").map(e => [e.order, e.rawSha256])).toEqual([[242376, "5ab5d9b480e60b88942d232ab081eccba1ed295e6d91108a3449ae0d6f42d455"]]);
      expect(evanescent.entries.every(e => e.role !== "candidate" || e.headword === "evanescent")).toBe(true);
      expect(evanescent.supplemental).toMatchObject({ page_id: "64368", revision_id: "92133237", revision_timestamp: "2026-08-23T18:06:03Z", authenticatesKaikki: false });
      expect(evanescent.supplemental.meanings.map(m => m.path)).toEqual([[1], [1, 1], [1, 2], [2], [3], [3, 1]]);
      expect(evanescent.meanings.filter(m => m.source === "kaikki")).toHaveLength(6);
      expect(evanescent.meanings.find(m => m.id === "line:242376:meaning:3")?.data).toMatchObject({ senseid: ["en:mathematics"], raw_glosses: ["Disappearing, vanishing.", expect.stringContaining("(mathematics)")], examples: expect.arrayContaining([expect.objectContaining({ type: "quotation", ref: expect.any(String) })]) });
      expect(evanescent.frequency).toEqual({ form: "evanescent", tokens: ["evanescent"], order: 79805, directZipf: 2.15, storedFrequency: 1.4125375446227555e-7 });
      const input = bundleFilterInput(evanescent), config = await loadPipelineConfig("config/pipeline.yaml");
      expect(input.labels).toEqual(expect.arrayContaining([expect.objectContaining({ value: "electromagnetism", kind: "raw_qualifier" }), expect.objectContaining({ value: "mathematics", kind: "topic" }), expect.objectContaining({ value: "botany", kind: "raw_qualifier" })]));
      expect(evaluateFilters(input, config).rules.map(r => r.outcome)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
      const projection = generationEvidence(evanescent);
      expect(projection.meanings).toEqual([{ id: "oewn-evanescent__5.00.00.impermanent.00", conceptId: "oewn-01761452-s", order: 1, definition: "tending to vanish like vapor", examples: ["evanescent beauty"] }]);
      expect(projection.relations.filter(r => r.source === "oewn" && r.purpose === "contrast").map(r => r.word)).toEqual(["impermanent", "temporary"]);
      expect(projection.relations.filter(r => r.source === "oewn" && r.purpose === "family").map(r => r.word)).toEqual(["evanesce", "evanescence"]);
      expect(JSON.stringify(projection)).not.toContain('"type":"quotation"');
      await executeSourceCommand(["candidates", "build", "--bundle", first.bundleId], openStore);
      const current = await authorizeScopedCandidate(store, first.bundleId, config);
      expect(current).toMatchObject({ headword: "evanescent", appropriatenessInput: { headword: "evanescent" }, usefulnessInput: { headword: "evanescent", partsOfSpeech: ["a"] } });
      const previous = await authorizeScopedCandidate(store, bundleId, config);
      expect(current.candidateId).not.toBe(previous.candidateId);
      expect(current.lessonId).not.toBe(previous.lessonId);
      await expect(executeSourceCommand(["candidate", "explain", "emulate", "--bundle", first.bundleId], openStore)).rejects.toThrow("candidate_outside_bundle_scope");
      await expect(executeSourceCommand(["candidate", "explain", "evanescent", "--bundle", bundleId], openStore)).rejects.toThrow("candidate_outside_bundle_scope");
      const counts = async () => (await pipeline.query("SELECT (SELECT count(*) FROM private.source_entries) AS entries, (SELECT count(*) FROM private.intake_assessments) AS assessments")).rows[0];
      const before = await counts();
      expect(await executeSourceCommand(args, openStore)).toMatchObject({ bundleId: first.bundleId, status: "ready", reused: true });
      await executeSourceCommand(["candidates", "build", "--bundle", first.bundleId], openStore);
      expect(await counts()).toEqual(before);
      const unreviewed = structuredClone(evanescent);
      unreviewed.supplemental.text_sha256 = "0".repeat(64);
      expect(evaluateFilters(bundleFilterInput(unreviewed), config).rules.find(r => r.rule === "spelling")?.outcome).toBe("unresolved");
      const missingEntry = structuredClone(evanescent);
      missingEntry.entries = missingEntry.entries.filter(e => e.source !== "kaikki");
      expect(bundleFilterInput(missingEntry).spellingVerified).toBe(false);
      expect(evaluateFilters(bundleFilterInput(missingEntry), config).disposition).toBe("unresolved");
      const changed = structuredClone(evanescent.scope);
      changed.mappingVersion = "evanescent-required-evidence-failure";
      const scopePath = resolve(temp, "evanescent-failure.json");
      const supplemental = z.object({ supplemental: z.record(z.string(), z.unknown()) }).parse(changed).supplemental;
      supplemental.textSha256 = "0".repeat(64);
      changed.supplemental = supplemental;
      await writeFile(scopePath, JSON.stringify(changed));
      await expect(executeSourceCommand(["sources", "import", "--scope", scopePath], openStore)).rejects.toThrow("scoped_supplemental_page_changed");
      expect(await store.readyBundle(bundleId)).toEqual(emulate);
      expect(await store.readyBundle(first.bundleId)).toEqual(evanescent);
      for (const table of SOURCE_TABLES) await expect(learner.query(`SELECT * FROM private.${table}`)).rejects.toMatchObject({ code: "42501" });
    } finally { await store.close(); }
  }, 180_000);
});
