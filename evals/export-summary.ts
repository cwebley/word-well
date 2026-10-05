// Aggregate-only Braintrust exporter (#8). Receives a finalized summary file
// and a Braintrust key, nothing else: no decryption key, database, private
// records or model client. Manual logging over the REST API, one row per
// private experiment. Retries reuse the same experiment and row, so a lost
// acknowledgement never duplicates or repeats a model call.
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parseSummary, summaryDigest, type Summary } from "./summarize.js";

const API = "https://api.braintrust.dev";
const PROJECT = "WordWell private appropriateness";

export class ExportError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const receiptSchema = z.object({
  schema: z.literal("wordwell-braintrust-export-receipt-v1"),
  experimentId: z.uuid(), summarySha256: z.string().regex(/^[a-f0-9]{64}$/),
  braintrustProjectId: z.string().max(200), braintrustExperimentId: z.string().max(200), rowId: z.uuid(),
  acknowledged: z.boolean(), at: z.iso.datetime()
}).strict();
export type ExportReceipt = z.infer<typeof receiptSchema>;

async function writeReceipt(directory: string, receipt: ExportReceipt) {
  const path = resolve(directory, `${receipt.experimentId}.json`);
  const temporary = resolve(directory, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(receiptSchema.parse(receipt), null, 2) + "\n"); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
  } catch { throw new ExportError("receipt_unavailable"); }
  finally { await rm(temporary, { force: true }); }
}

// Only validated values enter the row; no raw private object is forwarded.
function row(summary: Summary, sha256: string) {
  const scores: Record<string, number> = {};
  for (const [name, value] of Object.entries({ trials_correct: summary.rates.trialsCorrect, cases_passed: summary.rates.casesPassed,
    cases_all_three_correct: summary.rates.casesAllThreeCorrect, unstable_cases: summary.rates.unstableCases }))
    if (value.value !== null) scores[name] = value.value;
  return {
    id: summary.experimentId,
    input: { datasetId: summary.datasetId, datasetVersion: summary.datasetVersion,
      configurationFingerprint: summary.configurationFingerprint, pinnedModel: summary.pinnedModel, split: summary.split },
    output: { ...summary.counts, goldenRequirementsPass: summary.goldenRequirementsPass },
    scores,
    metadata: { schema: summary.schema, summarySha256: sha256, purpose: summary.purpose, passRule: summary.passRule, rates: summary.rates, cost: summary.cost, timing: summary.timing }
  };
}

export async function exportSummary(options: {
  summaryPath: string; receiptsDir: string; apiKey: string; fetch?: typeof globalThis.fetch;
}): Promise<ExportReceipt> {
  const fetch = options.fetch ?? globalThis.fetch;
  let summary: Summary;
  try { summary = parseSummary(JSON.parse(await readFile(options.summaryPath, "utf8"))); }
  catch { throw new ExportError("summary_invalid"); }
  const sha256 = summaryDigest(summary);
  try { await mkdir(options.receiptsDir, { recursive: true, mode: 0o700 }); }
  catch { throw new ExportError("receipt_unavailable"); }

  let previous: ExportReceipt | null = null;
  try { previous = receiptSchema.parse(JSON.parse(await readFile(resolve(options.receiptsDir, `${summary.experimentId}.json`), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ExportError("receipt_invalid"); }
  if (previous && previous.summarySha256 !== sha256) throw new ExportError("export_conflict");
  if (previous?.acknowledged) return previous;

  const post = async (path: string, body: unknown) => {
    let response: Response;
    try {
      response = await fetch(API + path, { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" } });
    } catch { throw new ExportError("upload_failed"); }
    // Response bodies are not echoed: fixed codes only.
    if (!response.ok) throw new ExportError(`upload_rejected_${response.status}`);
    try { return await response.json() as Record<string, unknown>; } catch { throw new ExportError("upload_failed"); }
  };

  // Both creates return the existing object when the name already exists.
  const project = await post("/v1/project", { name: PROJECT });
  const experiment = await post("/v1/experiment", { project_id: project.id, name: `appropriateness-${summary.experimentId}`,
    ensure_new: false, metadata: { summarySha256: sha256 } });
  const existing = (experiment.metadata as Record<string, unknown> | undefined)?.summarySha256;
  if (existing !== sha256) throw new ExportError("export_conflict");
  const receipt: ExportReceipt = { schema: "wordwell-braintrust-export-receipt-v1", experimentId: summary.experimentId, summarySha256: sha256,
    braintrustProjectId: String(project.id), braintrustExperimentId: String(experiment.id), rowId: summary.experimentId,
    acknowledged: false, at: new Date().toISOString() };
  await writeReceipt(options.receiptsDir, receipt);
  const inserted = await post(`/v1/experiment/${encodeURIComponent(String(experiment.id))}/insert`, { events: [row(summary, sha256)] });
  if (!Array.isArray(inserted.row_ids) || !inserted.row_ids.includes(summary.experimentId)) throw new ExportError("upload_unacknowledged");
  const acknowledged = { ...receipt, acknowledged: true, at: new Date().toISOString() };
  await writeReceipt(options.receiptsDir, acknowledged);
  return acknowledged;
}

async function main() {
  process.umask(0o077);
  const { values } = parseArgs({ options: { summary: { type: "string" } } });
  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!values.summary) throw new ExportError("summary_required");
  if (!apiKey) throw new ExportError("braintrust_key_required");
  const receipt = await exportSummary({ summaryPath: resolve(values.summary), apiKey,
    receiptsDir: resolve(homedir(), "Library/Application Support/WordWell/private-evaluation/exports") });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof ExportError ? error.code : "export_failed");
    process.exitCode = 1;
  });
}
