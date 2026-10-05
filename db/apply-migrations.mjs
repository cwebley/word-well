import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.dirname(fileURLToPath(import.meta.url));
// Learner tables first, then the private pipeline schema that grants against them.
const directories = [
  { directory: "migrations", prefix: "" },
  { directory: "private-migrations", prefix: "private/" }
];

export async function applyMigrations(connectionString, log = () => {}) {
  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('wordwell:schema-migrations'))");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const { directory, prefix } of directories) {
      const files = (await fs.readdir(path.join(root, directory))).filter((file) => file.endsWith(".sql")).sort();
      for (const file of files) {
        const name = prefix + file;
        const applied = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
        if (applied.rowCount) continue;
        await client.query("BEGIN");
        try {
          await client.query(await fs.readFile(path.join(root, directory, file), "utf8"));
          await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
        log(`Applied ${name}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('wordwell:schema-migrations'))");
    client.release();
    await pool.end();
  }
}
