import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('wordwell:schema-migrations'))");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const name of files) {
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
    if (applied.rowCount) continue;
    await client.query("BEGIN");
    try {
      await client.query(await fs.readFile(path.join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    console.log(`Applied ${name}`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('wordwell:schema-migrations'))");
  client.release();
  await pool.end();
}
