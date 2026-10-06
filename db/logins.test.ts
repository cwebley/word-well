// @vitest-environment node
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { z } from "zod";
import { applyMigrations } from "./apply-migrations.mjs";
import { databaseConnection, inDatabase } from "./connections.mjs";
import { testDatabase } from "../pipeline/testing/private-fixtures.js";

const configured = process.env.WORDWELL_ADMIN_DATABASE_URL && process.env.WORDWELL_LEARNER_DATABASE_URL && process.env.WORDWELL_PIPELINE_DATABASE_URL;
describe.skipIf(!configured)("actual PostgreSQL job logins", () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>;
  let admin: pg.Pool;
  let learner: pg.Pool;
  let pipeline: pg.Pool;

  beforeAll(async () => {
    // testDatabase uses an admin connection to create a fresh disposable database.
    process.env.DATABASE_URL ??= inDatabase(databaseConnection("admin"), "wordwell_test");
    fixture = await testDatabase();
    admin = new pg.Pool({ connectionString: fixture.adminUrl });
    learner = new pg.Pool({ connectionString: fixture.learnerUrl });
    pipeline = new pg.Pool({ connectionString: fixture.pipelineUrl });
    await admin.query(`INSERT INTO published_lessons (id, normalized_headword, record)
      VALUES ('lesson-candid', 'candid', '{"headword":"candid","normalizedHeadword":"candid","meanings":[{"definition":"A harmless test meaning."}]}')`);
  });
  afterAll(async () => {
    await Promise.all([admin?.end(), learner?.end(), pipeline?.end()]);
    await fixture?.drop();
  });

  const denied = async (pool: pg.Pool, sql: string) => {
    await expect(pool.query(sql)).rejects.toMatchObject({ code: "42501" });
  };

  it("authenticates each runtime connection as its own nonprivileged login", async () => {
    for (const [job, pool] of [["learner", learner], ["pipeline", pipeline]] as const) {
      const { rows: [role] } = await pool.query(`SELECT current_user, session_user, rolsuper, rolcreatedb,
        rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(role).toEqual({ current_user: `wordwell_${job}_login`, session_user: `wordwell_${job}_login`,
        rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false });
      for (const name of ["wordwell", job === "learner" ? "wordwell_pipeline" : "wordwell_learner"])
        await denied(pool, `SET ROLE ${name}`);
      await denied(pool, "CREATE SCHEMA runtime_schema");
      await denied(pool, "CREATE TABLE public.runtime_table (id int)");
      await denied(pool, "CREATE TEMP TABLE runtime_temp (id int)");
      await denied(pool, "CREATE ROLE runtime_admin SUPERUSER");
      await denied(pool, `ALTER ROLE wordwell_${job}_login SUPERUSER`);
      await denied(pool, "SELECT * FROM public.schema_migrations");
    }
  });

  it("allows published reads and denies every lesson mutation and private learner access", async () => {
    expect((await learner.query("SELECT normalized_headword FROM public.published_lessons")).rows).toEqual([{ normalized_headword: "candid" }]);
    await denied(learner, "INSERT INTO published_lessons (id, normalized_headword, record) VALUES ('bad','bad','{}')");
    await denied(learner, "UPDATE published_lessons SET available = false");
    await denied(learner, "DELETE FROM published_lessons");
    await denied(learner, "TRUNCATE published_lessons CASCADE");
    await denied(learner, "ALTER TABLE published_lessons ADD COLUMN bad int");
    await denied(learner, "CREATE TABLE private.runtime_table (id int)");
    const { rows } = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname = 'private'");
    for (const row of rows) {
      await denied(learner, `SELECT * FROM private.${pg.escapeIdentifier(row.tablename)} LIMIT 0`);
      await pipeline.query(`SELECT * FROM private.${pg.escapeIdentifier(row.tablename)} LIMIT 0`);
    }
    await denied(pipeline, "ALTER TABLE private.experiments ADD COLUMN bad int");
    await denied(pipeline, "DELETE FROM private.experiments");
    await denied(pipeline, "SELECT * FROM profiles");
    await denied(pipeline, "INSERT INTO published_lessons (id, normalized_headword, record) VALUES ('bad','bad','{}')");
  });

  it("keeps new public records denied and grants new private tables through migration-owner defaults", async () => {
    await admin.query("CREATE TABLE public.future_record (id int)");
    await admin.query("CREATE TABLE private.future_record (id int)");
    try {
      await pipeline.query("INSERT INTO private.future_record VALUES (1)");
      await pipeline.query("UPDATE private.future_record SET id = 2");
      expect((await pipeline.query("SELECT id FROM private.future_record")).rows).toEqual([{ id: 2 }]);
      await denied(pipeline, "DELETE FROM private.future_record");
      await denied(learner, "SELECT * FROM private.future_record");
      for (const pool of [learner, pipeline]) await denied(pool, "SELECT * FROM public.future_record");
      await applyMigrations(fixture.adminUrl);
      expect((await admin.query("SELECT count(*)::int AS count FROM published_lessons")).rows[0].count).toBe(1);
    } finally { await admin.query("DROP TABLE public.future_record, private.future_record"); }
  });

  it("serves an actual API process through the learner login and persists learner writes", async () => {
    const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "api/server.ts"], {
      env: { ...process.env, WORDWELL_LEARNER_DATABASE_URL: fixture.learnerUrl, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    try {
      const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("api_start_timeout")), 15_000);
        child.stdout!.on("data", (bytes: Buffer) => {
          const match = /WordWell API listening on (\d+)/.exec(bytes.toString());
          if (match) { clearTimeout(timer); resolve(Number(match[1])); }
        });
        child.once("exit", () => { clearTimeout(timer); reject(new Error("api_start_failed")); });
        child.once("error", () => { clearTimeout(timer); reject(new Error("api_start_failed")); });
      });
      const origin = `http://127.0.0.1:${port}`;
      const created = await fetch(`${origin}/profiles/anonymous`, { method: "POST" });
      expect(created.status).toBe(201);
      const body = z.object({ session: z.object({ grant: z.string() }) }).parse(await created.json());
      const headers = { authorization: `Bearer ${body.session.grant}` };
      const response = await fetch(`${origin}/learning-state`, { headers });
      expect(response.status).toBe(200);
      const state = z.object({ state: z.object({ delivery: z.object({ normalizedHeadword: z.string() }) }) }).parse(await response.json());
      expect(state.state.delivery.normalizedHeadword).toBe("candid");
      expect((await fetch(`${origin}/profile/history-accessed`, { method: "POST", headers })).status).toBe(200);
      expect((await fetch(`${origin}/product-signals`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "install_cta_shown", capability: "chromium_prompt", day: "2026-10-05" }) })).status).toBe(204);
      expect((await admin.query("SELECT count(*)::int AS count FROM profiles")).rows[0].count).toBe(1);
      expect((await admin.query("SELECT count(*)::int AS count FROM deliveries")).rows[0].count).toBe(1);
      expect((await admin.query("SELECT count(*)::int AS count FROM profile_access_events")).rows[0].count).toBe(1);
      expect((await admin.query("SELECT count(*)::int AS count FROM product_signals")).rows[0].count).toBe(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    }
  }, 20_000);
});
