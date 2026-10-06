import { spawnSync } from "node:child_process";
import { databaseConnection } from "../db/connections.mjs";

// Every test owns a unique migrated database. No development fixture writes.
const result = spawnSync(process.execPath, ["./node_modules/vitest/vitest.mjs", "run", "pipeline/intake.test.ts", "pipeline/sources/scoped.test.ts"], {
  stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseConnection("admin") }
});
process.exitCode = result.status ?? 1;
