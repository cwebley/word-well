// Read-only local report of saved private appropriateness experiments (#8, #12).
// Loopback only, script-free, escaped text, no caching, no external resources
// or browser storage. Viewing and refreshing make zero model calls; the
// runner passed in reads saved work only.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { PrivateError } from "../pipeline/storage/crypto.js";
import type { PrivateStore } from "../pipeline/storage/postgres.js";
import { escapeText as e } from "./authoring/page.js";
import { createPrivateAppropriatenessReader, type CaseResult } from "./private-appropriateness.js";
import { openLocalPrivateStore } from "./private-local.js";

type Runner = ReturnType<typeof createPrivateAppropriatenessReader>;
const uuid = z.uuid();

function equal(value: string, expected: string): boolean {
  const left = Buffer.from(value); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

const usd = (nano: number) => `$${(nano / 1e9).toFixed(6)}`;
const probability = (value: number | null) => value === null ? "–" : value.toFixed(2);

function verdictLabel(r: CaseResult): string {
  const problems = [
    ...r.trials.filter(t => t.state !== "valid").map(t => `trial ${t.trialIndex} ${t.code ?? t.state}`),
    ...r.score.trials.flatMap((t, i) => t.error ? [`trial ${i + 1} ${t.error.replace("_", " ")}`] : []),
    ...(r.score.averaged.error ? [`average ${r.score.averaged.error.replace("_", " ")}`] : [])
  ];
  // Wrong rejects are tolerated by the pass rule but still shown.
  if (r.score.pass) return problems.length ? `pass (tolerated: ${problems.join("; ")})` : "pass";
  return problems.join("; ") || "incomplete";
}

function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title>
    <style>body{font:16px system-ui;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#202020;background:#fafaf6}
    table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.35rem .5rem;text-align:left;vertical-align:top}
    th{background:#eee}.fail{background:#fbe9e7}.pass{background:#edf7ed}.mono{font-family:ui-monospace,monospace;font-size:13px}
    pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f1f1ec;padding:.5rem}a{color:#174a7e}
    .scroll{overflow-x:auto}</style></head><body>
    <p><a href="/">All experiments</a></p>
    <h1>${e(title)}</h1>
    <p>Local report. No model calls. Private text exists in browser and process memory; this page uses no browser storage
      or external resources. Close the page when finished. Stopping the server does not erase a rendered page.</p>
    ${body}</body></html>`;
}

async function indexPage(store: PrivateStore, runner: Runner): Promise<string> {
  const experiments = (await store.listExperiments()).filter(x => x.stage === "appropriateness");
  const rows = await Promise.all(experiments.map(async x => {
    const [info, status] = await Promise.all([runner.describe(x.id), runner.status(x.id)]);
    const s = status.summary;
    const previous = experiments.find(y => y.datasetId === x.datasetId && y.createdAt < x.createdAt);
    return `<tr><td class="mono"><a href="/experiment/${x.id}">${x.id}</a></td><td>${e(x.createdAt.toISOString())}</td>
      <td class="mono">${e(x.datasetId.slice(0, 8))} v${x.datasetVersion} ${e(info.split)}</td><td>${e(info.configurationName)}</td>
      <td>${s.cases}</td><td>${s.passedCases}/${s.cases}</td><td>${s.trialWrongAccepts}/${s.trialWrongRejects}</td>
      <td>${s.invalidTrials + s.failedTrials + s.unresolvedTrials}</td><td>${s.missingTrials}</td>
      <td>${s.goldenRequirementsPass ? "yes" : "no"}</td><td>${usd(status.spend.knownNanoUsd)}</td>
      <td>${previous ? `<a href="/compare/${previous.id}/${x.id}">vs previous</a>` : "–"}</td></tr>`;
  }));
  return layout("Private appropriateness experiments", `<div class="scroll"><table><thead><tr><th>Experiment</th><th>Created</th><th>Dataset</th>
    <th>Configuration</th><th>Cases</th><th>Cases passed</th><th>Trial wrong accepts / rejects</th><th>Invalid or failed trials</th>
    <th>Missing trials</th><th>All requirements pass</th><th>Known cost</th><th>Compare</th></tr></thead>
    <tbody>${rows.join("") || '<tr><td colspan="12">No experiments.</td></tr>'}</tbody></table></div>`);
}

async function experimentPage(runner: Runner, id: string, filter: string | null): Promise<string> {
  const [info, status, results] = await Promise.all([runner.describe(id), runner.status(id), runner.caseResults(id)]);
  const shown = results.filter(r => filter === "mistakes" ? !r.score.pass && r.score.complete
    : filter === "incomplete" ? !r.score.complete : true);
  const s = status.summary;
  const rows = shown.map(r => {
    const trials = r.trials.map(t => `<td>${t.state === "valid" ? `${probability(t.blockedProbability)}${t.slurProbability === null ? "" : ` / slur ${probability(t.slurProbability)}`}${t.vulgarProbability === null ? "" : ` / vulgar ${probability(t.vulgarProbability)}`} ${t.disposition}` : e(t.code ?? t.state)}
      ${t.physicalRequests > 1 ? `<br><small>${t.physicalRequests} requests</small>` : ""}</td>`).join("");
    const raw = r.trials.flatMap(t => t.requests.map(q => `<p>Trial ${t.trialIndex}, request ${q.sequence}: ${e(q.status)} ${q.httpStatus ?? ""}</p>
      <pre>${e(q.body ?? "(no saved body)")}</pre>`)).join("");
    return `<tr class="${r.score.pass ? "pass" : "fail"}"><td>${e(r.headword)}</td><td>${e(r.split)}</td><td>${e(r.expected)}</td>
      <td>${e(r.reason || "–")}</td>${trials}<td>${r.score.averaged.blockedProbability === null ? "–" : r.score.averaged.blockedProbability.toFixed(3)}
      ${r.score.averaged.slurProbability == null ? "" : ` / slur ${r.score.averaged.slurProbability.toFixed(3)}`}${r.score.averaged.vulgarProbability == null ? "" : ` / vulgar ${r.score.averaged.vulgarProbability.toFixed(3)}`} ${e(r.score.averaged.disposition ?? "")}</td><td>${e(verdictLabel(r))}</td>
      <td><details><summary>raw replies</summary>${raw || "<p>None saved.</p>"}</details></td></tr>`;
  }).join("");
  return layout(`Experiment ${id}`, `<p>Configuration <strong>${e(info.configurationName)}</strong> (${e(info.configurationFingerprint.slice(0, 12))}): requested ${e(info.requestedModel)},
      pinned ${e(info.pinnedModel)}, question ${e(info.questionId)}. Dataset ${e(info.dataset.id)} v${info.dataset.version},
      split ${e(info.split)}, purpose ${e(info.purpose)}.
      Cap ${usd(info.capNanoUsd)}; pricing ${e(info.pricingStatus)}.</p>
    <p>Cases ${s.cases}; passed ${s.passedCases}; all three trials correct ${s.casesAllThreeCorrect}; unstable ${s.unstableCases}.
      Trials: ${s.validTrials} valid, ${s.invalidTrials} invalid, ${s.failedTrials} failed, ${s.unresolvedTrials} unresolved, ${s.missingTrials} missing
      of ${s.requiredTrials}. Trial wrong accepts ${s.trialWrongAccepts}, wrong rejects ${s.trialWrongRejects}. Average wrong accepts
      ${s.averagedWrongAccepts}, wrong rejects ${s.averagedWrongRejects}. All requirements pass: ${s.goldenRequirementsPass ? "yes" : "no"}.
      Known cost ${usd(status.spend.knownNanoUsd)}; ${status.spend.unresolvedRequests} unresolved requests; ${status.spend.physicalRequests} physical requests.</p>
    <p>Show: <a href="/experiment/${id}">all</a> · <a href="/experiment/${id}?filter=mistakes">mistakes</a> ·
      <a href="/experiment/${id}?filter=incomplete">incomplete</a>. Numbers are blocked probabilities, plus slur- and vulgar-sense probabilities where asked; reject when any reaches its threshold (0.50 unless the configuration sets another).</p>
    <div class="scroll"><table><thead><tr><th>Word</th><th>Split</th><th>Expected</th><th>Owner reason</th><th>Trial 1</th><th>Trial 2</th>
      <th>Trial 3</th><th>Average</th><th>Result</th><th>Replies</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10">No cases match.</td></tr>'}</tbody></table></div>`);
}

async function comparePage(runner: Runner, a: string, b: string): Promise<string> {
  const [infoA, infoB, resultsA, resultsB] = await Promise.all([runner.describe(a), runner.describe(b), runner.caseResults(a), runner.caseResults(b)]);
  if (infoA.dataset.id !== infoB.dataset.id) throw new PrivateError("different_dataset");
  const other = new Map(resultsB.map(r => [r.caseId, r]));
  const cell = (r?: CaseResult) => r ? `<td>${r.score.averaged.blockedProbability === null ? "–" : r.score.averaged.blockedProbability.toFixed(3)}</td>
    <td>${r.trials.map(t => t.state === "valid" ? probability(t.blockedProbability) : e(t.code ?? t.state)).join(", ")}</td><td>${r.score.pass ? "pass" : "fail"}</td>`
    : "<td colspan=3>–</td>";
  const rows = resultsA.map(r => {
    const s = other.get(r.caseId);
    return `<tr class="${s && s.score.pass !== r.score.pass ? "fail" : ""}"><td>${e(r.headword)}</td><td>${e(r.expected)}</td>${cell(r)}${cell(s)}</tr>`;
  }).join("");
  return layout("Compare experiments", `<p>A: <a href="/experiment/${a}">${a}</a>, configuration <strong>${e(infoA.configurationName)}</strong>, pinned ${e(infoA.pinnedModel)}.</p>
    <p>B: <a href="/experiment/${b}">${b}</a>, configuration <strong>${e(infoB.configurationName)}</strong>, pinned ${e(infoB.pinnedModel)}.</p>
    <p>Same frozen dataset ${e(infoA.dataset.id)} v${infoA.dataset.version}. Highlighted rows changed pass/fail.</p>
    <div class="scroll"><table><thead><tr><th>Word</th><th>Expected</th><th>A average</th><th>A trials</th><th>A</th>
      <th>B average</th><th>B trials</th><th>B</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}

export async function startReportServer({ store, runner, port = 0 }: { store: PrivateStore; runner: Runner; port?: number }) {
  const session = randomBytes(32).toString("hex");
  let origin = "";
  const headers = (response: ServerResponse) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Frame-Options", "DENY");
  };
  const server = createServer(async (request, response) => {
    headers(response);
    const deny = (status: number, code: string) => { response.statusCode = status; response.end(code); };
    try {
      if (request.method !== "GET") return deny(405, "method_rejected");
      if (request.headers.host !== new URL(origin).host) return deny(403, "session_required");
      const site = request.headers["sec-fetch-site"];
      if (site && !["none", "same-origin"].includes(String(site))) return deny(403, "session_required");
      if (equal(request.url ?? "", `/session/${session}`)) {
        response.setHeader("Set-Cookie", `ww-report=${session}; HttpOnly; SameSite=Strict; Path=/`);
        response.statusCode = 303; response.setHeader("Location", "/"); response.end(); return;
      }
      const cookie = request.headers.cookie?.split("; ").find(part => part.startsWith("ww-report="))?.slice(10) ?? "";
      if (!equal(cookie, session)) return deny(403, "session_required");
      const url = new URL(request.url ?? "/", origin);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length === 0) return response.end(await indexPage(store, runner));
      if (parts[0] === "experiment" && parts.length === 2 && uuid.safeParse(parts[1]).success)
        return response.end(await experimentPage(runner, parts[1], url.searchParams.get("filter")));
      if (parts[0] === "compare" && parts.length === 3 && parts.slice(1).every(id => uuid.safeParse(id).success))
        return response.end(await comparePage(runner, parts[1], parts[2]));
      return deny(404, "not_found");
    } catch (error) {
      // No exception object or private value leaves the process.
      const code = error instanceof PrivateError ? error.code : "report_failed";
      deny(code === "experiment_missing" ? 404 : 503, code);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((done, fail) => {
    server.once("error", () => fail(new PrivateError("server_unavailable")));
    server.listen(port, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new PrivateError("server_unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/session/${session}`,
    origin,
    async close() {
      await new Promise<void>((done, fail) => {
        server.close(error => error ? fail(new PrivateError("server_unavailable")) : done());
        server.closeAllConnections();
      });
    }
  };
}

async function main() {
  process.umask(0o077);
  const { store } = await openLocalPrivateStore();
  // A reader only: no ledger and no model client, so the report cannot dispatch.
  const server = await startReportServer({ store, runner: createPrivateAppropriatenessReader(store) });
  console.log(`Open this local report in your browser: ${server.url}`);
  console.log("Stop with Ctrl-C. No model client is loaded.");
  const stop = () => { void server.close().then(() => store.close()).then(() => process.exit(0)); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof PrivateError ? error.code : "report_failed");
    process.exitCode = 1;
  });
}
