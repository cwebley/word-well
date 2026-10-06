import { applyMigrations } from "./apply-migrations.mjs";
import { databaseConnection } from "./connections.mjs";

const databaseUrl = process.env.DATABASE_URL ?? databaseConnection("admin");
await applyMigrations(databaseUrl, (line) => console.log(line));
