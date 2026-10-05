// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// An unverified-pricing copy of the real config, so the refusal is tested
// regardless of the checkout's current pricing status.
const config = JSON.parse(readFileSync("config/private-appropriateness.json", "utf8"));
const unverified = resolve(mkdtempSync(resolve(tmpdir(), "ww-cli-test-")), "config.json");
writeFileSync(unverified, JSON.stringify({ ...config, pricing: { ...config.pricing, status: "unverified" } }));

const cli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "evals/private-appropriateness-cli.ts", ...args],
  { encoding: "utf8", env: { ...process.env, OPENROUTER_API_KEY: "harmless-test-key", WORDWELL_PRIVATE_CONFIG: unverified } });

it.each([
  ["run", "--dataset", "appropriateness-v000001", "--max-cost-usd", "0.50"],
  ["resume", "00000000-0000-4000-8000-000000000000"]
])("refuses live dispatch while pricing is unverified, before loading keys or the database (%s)", (...args) => {
  const result = cli(...args);
  expect(result.status).toBe(1);
  expect(result.stderr.trim()).toBe("live_dispatch_refused_pricing_unverified");
  expect(result.stdout).toBe("");
});

it("rejects unknown operations with a fixed code", () => {
  expect(cli("delete").stderr.trim()).toBe("use_run_resume_status_finalize_smoke_or_audit");
});

it("audits only committed public word lists, refusing before keys or the database", () => {
  const result = cli("audit", "--words-from", "evals/datasets/appropriateness-v000001/cases.age", "--max-cost-usd", "0.10");
  expect(result.stderr.trim()).toBe("audit_source_not_public");
  expect(cli("audit", "--max-cost-usd", "5").stderr.trim()).toBe("audit_cap_too_high");
});

it("never sends held-out words unless a split is named, and caps the smoke run at the approved $0.05", () => {
  const verified = { encoding: "utf8" as const, env: { ...process.env, OPENROUTER_API_KEY: "harmless-test-key" } };
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "evals/private-appropriateness-cli.ts", ...args], verified);
  expect(run("run", "--dataset", "appropriateness-v000001", "--max-cost-usd", "0.25").stderr.trim()).toBe("split_required");
  expect(run("smoke", "--max-cost-usd", "0.06").stderr.trim()).toBe("smoke_cap_too_high");
});
