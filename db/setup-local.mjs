import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations } from "./apply-migrations.mjs";
import { databaseConnection, inDatabase } from "./connections.mjs";

const file = fileURLToPath(new URL("../.env.database", import.meta.url));

async function main() {
  // Provision the existing local cluster. Never recreate a database or volume.
  try { await readFile(file); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const admin = process.env.WORDWELL_ADMIN_DATABASE_URL ?? "postgresql://wordwell:wordwell@127.0.0.1:54329/wordwell_dev";
    const url = new URL(admin);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("local_database_required");
    const lines = [`WORDWELL_ADMIN_DATABASE_URL=${JSON.stringify(admin)}`];
    for (const job of ["learner", "pipeline"]) {
      const connection = new URL(admin);
      connection.username = `wordwell_${job}_login`;
      connection.password = randomBytes(32).toString("hex");
      lines.push(`WORDWELL_${job.toUpperCase()}_DATABASE_URL=${JSON.stringify(connection.toString())}`);
    }
    await writeFile(file, lines.join("\n") + "\n", { flag: "wx", mode: 0o600 });
    process.loadEnvFile(file);
  }
  await chmod(file, 0o600);
  const adminUrl = databaseConnection("admin");
  const address = new URL(adminUrl);
  if (!["127.0.0.1", "localhost"].includes(address.hostname) || address.pathname !== "/wordwell_dev")
    throw new Error("local_development_database_required");
  const admin = new pg.Pool({ connectionString: inDatabase(adminUrl, "postgres") });
  const client = await admin.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('wordwell:local-setup'))");
    for (const name of ["wordwell_dev", "wordwell_test"]) {
      const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
      if (!exists.rowCount) await client.query(`CREATE DATABASE ${pg.escapeIdentifier(name)}`);
      await applyMigrations(inDatabase(adminUrl, name), console.log);
    }
    // Passwords are reused from the local file. Repeat setup adds no new keys.
    for (const job of ["learner", "pipeline"]) {
      const url = new URL(databaseConnection(job));
      if (url.host !== address.host || url.pathname !== address.pathname) throw new Error("local_connection_mismatch");
      const name = decodeURIComponent(url.username);
      const role = pg.escapeIdentifier(name);
      const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
      if (!exists.rowCount) await client.query(`CREATE ROLE ${role} NOLOGIN`);
      // Memberships must never provide another job's rights or admin escalation.
      const { rows } = await client.query(`SELECT parent.rolname FROM pg_auth_members m
        JOIN pg_roles parent ON parent.oid = m.roleid JOIN pg_roles member ON member.oid = m.member
        WHERE member.rolname = $1`, [name]);
      for (const parent of rows) await client.query(`REVOKE ${pg.escapeIdentifier(parent.rolname)} FROM ${role}`);
      await client.query(`ALTER ROLE ${role} LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        PASSWORD ${pg.escapeLiteral(decodeURIComponent(url.password))}`);
      await client.query(`GRANT wordwell_${job} TO ${role}`);
    }
    console.log("Local admin, learner and pipeline connections ready. Credentials are in .env.database.");
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('wordwell:local-setup'))");
    client.release();
    await admin.end();
  }
}

main().catch(() => { console.error("local_database_setup_failed"); process.exitCode = 1; });
