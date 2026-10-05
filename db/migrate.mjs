import { applyMigrations } from "./apply-migrations.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
await applyMigrations(databaseUrl, (line) => console.log(line));
