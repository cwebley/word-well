// Command line for private appropriateness evaluation. Kept apart from the
// runner so CLI and printing changes never alter the implementation identity
// that saved experiments resume against.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createSystemOneAdapter, SYSTEM_ONE_ROUTE } from "../pipeline/execution/system-one.js";
import { APPROPRIATENESS_CONFIGURATION, CONFIGURATIONS, thresholdsFor, type Thresholds } from "../pipeline/stages/appropriateness.js";
import { PrivateError, type KeyReference, type PrivateCrypto } from "../pipeline/storage/crypto.js";
import { readBytes } from "../pipeline/storage/files.js";
import { createReceiptLedger } from "../pipeline/storage/receipts.js";
import { createAuthoringStore, manifestSchema } from "./authoring/store.js";
import { createPrivateAppropriatenessRunner, implementationIdentity, loadLocalConfig, type CaseResult } from "./private-appropriateness.js";
import { checkout, ledgerDir, openLocalPrivateStore, summariesDir } from "./private-local.js";

// Owner-approved live checks on #15: harmless public words only, so the
// provider prerequisites for sensitive cases do not apply. Stand-in clear
// expectations, not golden labels. Their per-word output is safe to print.
export const SMOKE_WORDS = ["exuberant", "meticulous", "ephemeral", "clavicle", "serendipity"];
const SMOKE_MAX_CAP_USD = 0.05;
const AUDIT_MAX_CAP_USD = 0.25;

// Freezes harmless public words with stand-in clear expectations into a temp
// encrypted dataset, so smoke and audit runs use the real runner unchanged.
export async function freezeStandInDataset(root: string, words: string[], keys: { storageKey: KeyReference; datasetKey: KeyReference }, crypto: PrivateCrypto) {
  const datasetDir = resolve(root, "datasets");
  await mkdir(datasetDir, { mode: 0o700 });
  const authoring = await createAuthoringStore({ privateDir: resolve(root, "private"), checkout, datasetDir,
    workspaceId: randomUUID(), ...keys, crypto });
  for (const headword of words) {
    await authoring.execute({ action: "save", revision: (await authoring.load()).revision, split: "development", content: {
      headword, finding: "clear", reason: "Harmless public stand-in, not a golden label.", firm: true,
      provenance: "public", variantGroup: randomUUID(), answersInspected: false } });
  }
  const { manifest } = await authoring.execute({ action: "freeze", revision: (await authoring.load()).revision, version: 1 });
  return { datasetDir: resolve(datasetDir, "appropriateness-v000001"), manifest: manifest! };
}

const probability = (value: number | null | undefined, digits = 2) => value == null ? "-" : value.toFixed(digits);

// Which questions put the average at or over their thresholds.
function rejectedBy(r: CaseResult, thresholds: Thresholds): string {
  const a = r.score.averaged;
  return [a.blockedProbability != null && a.blockedProbability >= thresholds.blocked ? "main" : "",
    a.slurProbability != null && a.slurProbability >= thresholds.slur ? "slur" : "",
    a.vulgarProbability != null && a.vulgarProbability >= thresholds.vulgar ? "vulgar" : ""].filter(Boolean).join("+");
}

// Public words only: lists each word the configuration would block and why.
function printAuditBlocks(results: CaseResult[], thresholds: Thresholds) {
  const blocked = results.filter(r => r.score.averaged.disposition === "reject" || r.trials.some(t => t.disposition === "reject"));
  console.log(`${blocked.length} of ${results.length} public words blocked on the average or on at least one trial.`);
  for (const r of blocked) {
    const a = r.score.averaged;
    console.log(`${r.headword.padEnd(20)} main ${probability(a.blockedProbability)}  slur ${probability(a.slurProbability)}  vulgar ${probability(a.vulgarProbability)}  -> ${rejectedBy(r, thresholds) || "one trial only"}`);
  }
}

function printSmokeTable(results: CaseResult[], thresholds: Thresholds) {
  const cell = (value: string, width: number) => value.padEnd(width);
  const trial = (t: CaseResult["trials"][number]) => t.state !== "valid" ? t.code ?? t.state
    : probability(t.blockedProbability) + (t.slurProbability === null ? "" : `/${probability(t.slurProbability)}`);
  console.log([cell("word", 14), cell("expected", 9), cell("trial 1", 11), cell("trial 2", 11), cell("trial 3", 11), cell("average", 13), cell("verdict", 8), "pass"].join(""));
  for (const r of results) {
    const a = r.score.averaged;
    const average = probability(a.blockedProbability, 3) + (a.slurProbability == null ? "" : `/${probability(a.slurProbability, 3)}`);
    console.log([cell(r.headword, 14), cell(r.expected, 9), ...r.trials.map(t => cell(trial(t), 11)), cell(average, 13),
      cell(a.disposition ?? "-", 8), r.score.pass ? "yes" : "no"].join(""));
  }
  console.log(`Numbers are blocked probability / slur-sense probability. A word is rejected when blocked reaches ${thresholds.blocked.toFixed(2)} or slur reaches ${thresholds.slur.toFixed(2)}.`);
}

async function main() {
  process.umask(0o077);
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    dataset: { type: "string" }, "max-cost-usd": { type: "string" }, split: { type: "string" }, configuration: { type: "string" },
    "words-from": { type: "string" }
  } });
  // Named prompt configurations; the default is the current stage configuration.
  const configuration = values.configuration === undefined ? APPROPRIATENESS_CONFIGURATION : CONFIGURATIONS[values.configuration];
  if (!configuration) throw new PrivateError("configuration_unknown");
  const [operation, experimentId] = positionals;
  if (!["run", "resume", "status", "finalize", "smoke", "audit"].includes(operation ?? "")) throw new PrivateError("use_run_resume_status_finalize_smoke_or_audit");
  // Tests may point at a harmless alternative config; the default is the checkout's.
  const configPath = process.env.WORDWELL_PRIVATE_CONFIG ?? resolve(checkout, "config/private-appropriateness.json");
  const config = loadLocalConfig(JSON.parse((await readBytes(configPath)).toString()));
  // No live call on private cases until the owner verifies pricing and
  // provider privacy (#17). Smoke and audit send harmless public words only.
  if ((operation === "run" || operation === "resume") && config.pricing.status !== "verified")
    throw new PrivateError("live_dispatch_refused_pricing_unverified");
  if (["resume", "status", "finalize"].includes(operation!) && !z.uuid().safeParse(experimentId).success) throw new PrivateError("experiment_id_required");
  // Held-out words are sent only when asked for by name.
  if (operation === "run" && !["development", "held-out", "all"].includes(values.split ?? "")) throw new PrivateError("split_required");
  const cap = Number(values["max-cost-usd"]);
  if (["run", "smoke", "audit"].includes(operation!) && !(cap > 0)) throw new PrivateError("arguments_invalid");
  if (operation === "audit" && cap > AUDIT_MAX_CAP_USD) throw new PrivateError("audit_cap_too_high");
  if (operation === "smoke" && cap > SMOKE_MAX_CAP_USD) throw new PrivateError("smoke_cap_too_high");
  // Audits read public words only, from the committed usefulness development sets.
  const auditSource = values["words-from"] ?? "evals/datasets/usefulness-dev-v9.json";
  if (operation === "audit" && !/^evals\/datasets\/usefulness-dev-v[0-9]+\.json$/.test(auditSource)) throw new PrivateError("audit_source_not_public");
  const dispatches = ["run", "resume", "smoke", "audit"].includes(operation!);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (dispatches && !apiKey) throw new PrivateError("openrouter_key_required");

  const { store, crypto, keys } = await openLocalPrivateStore();
  try {
    const runner = createPrivateAppropriatenessRunner({
      store, ledger: await createReceiptLedger({ directory: ledgerDir, checkout }), implementation: await implementationIdentity(),
      // Only commands that dispatch get a model client.
      models: dispatches ? { [SYSTEM_ONE_ROUTE]: createSystemOneAdapter({ apiKey: apiKey! }) } : {}
    });
    const thresholds = thresholdsFor(configuration);
    let id = experimentId;
    if (operation === "audit" || operation === "smoke") {
      const words = operation === "smoke" ? SMOKE_WORDS
        : z.object({ cases: z.array(z.object({ headword: z.string().min(1).max(200) }).passthrough()).min(1).max(1000) }).passthrough()
          .parse(JSON.parse((await readBytes(resolve(checkout, auditSource))).toString())).cases.map(c => c.headword);
      const root = await mkdtemp(resolve(tmpdir(), `ww-${operation}-`));
      try {
        const frozen = await freezeStandInDataset(root, words, keys, crypto);
        id = await runner.create({ ...frozen, datasetCrypto: crypto, capNanoUsd: Math.round(cap * 1e9), configuration, config, purpose: operation });
      } finally { await rm(root, { recursive: true, force: true }); }
      console.log(`${operation} experiment ${id}: ${words.length} public words, configuration ${values.configuration ?? "default"}`);
      const report = await runner.run(id);
      const results = await runner.caseResults(id);
      if (operation === "audit") printAuditBlocks(results, thresholds);
      else printSmokeTable(results, thresholds);
      console.log(JSON.stringify({ stopped: report.stopped, summary: report.summary, spend: report.spend }, null, 2));
      return;
    }
    if (operation === "finalize") {
      // Aggregate-only artifact for the separate exporter. Zero model calls.
      console.log(JSON.stringify(await runner.finalize(id!, { summariesDir }), null, 2));
      return;
    }
    if (operation === "run") {
      if (!values.dataset || !/^appropriateness-v[0-9]{6}$/.test(values.dataset)) throw new PrivateError("arguments_invalid");
      const datasetDir = resolve(checkout, "evals/datasets", values.dataset);
      const manifest = manifestSchema.parse(JSON.parse((await readBytes(resolve(datasetDir, "manifest.json"))).toString()));
      id = await runner.create({ datasetDir, manifest, datasetCrypto: crypto, capNanoUsd: Math.round(cap * 1e9), configuration, config,
        split: values.split === "all" ? undefined : values.split as "development" | "held-out" });
      console.log(`experiment ${id}`);
    }
    const report = operation === "status" ? await runner.status(id!) : await runner.run(id!);
    // Aggregate counts and amounts only.
    console.log(JSON.stringify(report, null, 2));
  } finally { await store.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof PrivateError ? error.code : "private_evaluation_failed");
    process.exitCode = 1;
  });
}
