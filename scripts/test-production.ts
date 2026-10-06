import { spawnSync } from "node:child_process";
import { databaseConnection } from "../db/connections.mjs";
// Actual restricted stores in disposable databases. No development writes.
const result = spawnSync(process.execPath, ["./node_modules/vitest/vitest.mjs", "run", "pipeline/run.test.ts", "pipeline/promotion.test.ts"], {
  stdio: "inherit", env: { ...process.env, DATABASE_URL: databaseConnection("admin") }
});
process.exitCode = result.status ?? 1;
