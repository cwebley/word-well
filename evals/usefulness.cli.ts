// Usefulness eval command. Writes the experiment and its Jev answers to a
// private directory; the answers file is itself a replay source for later runs.
//
//   npm run eval:usefulness -- --dataset evals/datasets/usefulness-dev-v1.json \
//     --combiner config/usefulness-combiner-<id>.json --replay-from <answers.json> [--replay-from ...]
//   npm run eval:usefulness -- --dataset ... --combiner ... --jev live --max-requests 450
// Live mode reads OPENROUTER_API_KEY from the environment and spends money.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { httpJev, replayJev } from "../pipeline/execution/jev.js";
import { configId, loadCombiner, MODEL, QUESTIONS, renderState } from "../pipeline/stages/usefulness.js";
import { loadUsefulnessDataset } from "./datasets/usefulness.js";
import { runUsefulnessEval, type UsefulnessRun } from "./usefulness.js";

const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    combiner: { type: "string" },
    jev: { type: "string", default: "replay" },
    "replay-from": { type: "string", multiple: true },
    "max-requests": { type: "string" },
    "fit-report": { type: "string" },
    "out-dir": { type: "string", default: join(homedir(), "src/wordwell-private/runs/usefulness") }
  }
});
if (!values.dataset || !values.combiner) throw new Error("Required: --dataset and --combiner");
const live = values.jev === "live";
if (!live && values.jev !== "replay") throw new Error("--jev must be replay or live");
if (!live && !values["replay-from"]?.length) throw new Error("Replay needs at least one --replay-from");
const maxRequests = Number(values["max-requests"]);
if (live && !(Number.isInteger(maxRequests) && maxRequests > 0)) throw new Error("Live runs need --max-requests");
const apiKey = process.env.OPENROUTER_API_KEY;
if (live && !apiKey) throw new Error("Live runs need OPENROUTER_API_KEY");

const dataset = loadUsefulnessDataset(values.dataset);
const combiner = loadCombiner(JSON.parse(readFileSync(values.combiner, "utf8")));
const startedAt = new Date().toISOString();
const attemptsDir = join(values["out-dir"], "attempts", startedAt.replace(/[:.]/g, "-"));
const jev = live
  ? httpJev({ apiKey: apiKey!, maxRequests, attemptsDir })
  : replayJev(values["replay-from"]!);
const run = await runUsefulnessEval({ cases: dataset.cases, combiner, jev });
const attempts = live ? readdirSync(attemptsDir).map((f) => JSON.parse(readFileSync(join(attemptsDir, f), "utf8")) as { costUsd?: number | null }) : [];

const git = (cmd: string) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim();
const createdAt = startedAt;
const identity = {
  dataset: { name: dataset.name, split: dataset.split, version: dataset.version },
  configId: configId(combiner),
  combinerId: combiner.id,
  jev: live
    ? { mode: "live", attemptsDir, requests: attempts.length, knownCostUsd: attempts.reduce((sum, a) => sum + (a.costUsd ?? 0), 0), unknownCost: attempts.filter((a) => a.costUsd == null).length }
    : { mode: "replay", sources: values["replay-from"] },
  git: { revision: git("rev-parse HEAD"), dirty: git("status --porcelain -- pipeline evals config") !== "" }
};
const experimentId = `${createdAt.replace(/[:.]/g, "-")}-${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 8)}`;

mkdirSync(values["out-dir"], { recursive: true, mode: 0o700 });
const base = join(values["out-dir"], experimentId);
writeFileSync(`${base}.json`, JSON.stringify({
  schema: "wordwell-usefulness-experiment/v1", experimentId, createdAt, ...identity,
  error: run.error, report: run.report,
  rows: run.rows.map((r) => ({ caseId: r.case.id, headword: r.case.headword, result: r.result }))
}, null, 1));
writeFileSync(`${base}.answers.json`, JSON.stringify({
  schema: "wordwell-jev-answers/v1",
  questions: QUESTIONS,
  answers: run.rows.flatMap((r) => (r.result?.trials ?? []).flatMap((t, i) =>
    Object.entries(t.answers).map(([question, answer]) => ({
      model: MODEL, state: renderState({ headword: r.case.headword, partsOfSpeech: r.case.partsOfSpeech }), question, trial: i + 1, answer
    }))))
}));

console.log(format(run, identity, values["fit-report"]));
console.log(`\nexperiment -> ${base}.json`);

function format(run: UsefulnessRun, id: typeof identity, fitReport?: string): string {
  const r = run.report;
  const pct = (v: number | null) => v === null ? "n/a" : v.toFixed(3);
  const tally = (t: Record<string, { cases: number; correct: number } | undefined>) =>
    Object.entries(t).map(([k, v]) => `${k} ${v!.correct}/${v!.cases}`).join(", ");
  const lines = [
    `dataset ${id.dataset.name} (${id.dataset.split}) ${id.dataset.version.slice(0, 12)}`,
    `jev ${id.jev.mode}${id.jev.mode === "live" ? `  ${id.jev.requests} requests, $${id.jev.knownCostUsd!.toFixed(6)} known cost, ${id.jev.unknownCost} unknown` : ""}`,
    `combiner ${id.combinerId.slice(0, 12)}  config ${id.configId.slice(0, 12)}  git ${id.git.revision.slice(0, 7)}${id.git.dirty ? " (dirty)" : ""}`,
    "",
    `precision on keeps  ${pct(r.precision)}`,
    `recall on keeps     ${pct(r.recall)}`,
    `counts              TP ${r.counts.truePositive}  FP ${r.counts.falsePositive}  FN ${r.counts.falseNegative}  TN ${r.counts.trueNegative}`,
    `wrong admits        too_familiar ${r.wrongAdmits.too_familiar}, too_specific ${r.wrongAdmits.too_specific}, intake_should_catch ${r.wrongAdmits.intake_should_catch}`,
    `by category         ${tally(r.byCategory)}`,
    `by difficulty       ${tally(r.byDifficulty)}`,
    `intake_should_catch ${r.intakeShouldCatch.cases} cases, admitted: ${r.intakeShouldCatch.admitted.join(", ") || "none"}`,
    `soft                ${r.soft.agreedWithLean}/${r.soft.cases} agreed with owner lean (not scored)`,
    `flips               ${r.flips.join(", ") || "none"}`,
    `incomplete          ${r.incomplete.length} of ${r.cases}${r.incomplete.length ? ": " + r.incomplete.join(", ") : ""}`
  ];
  if (run.error) lines.push(`STOPPED             ${run.error.kind} at ${run.error.headword}: ${run.error.message}`);
  if (fitReport) {
    const cv = JSON.parse(readFileSync(fitReport, "utf8")).development_cv.rows as { expected: string; predicted: string }[];
    const tp = cv.filter((x) => x.expected === "keep" && x.predicted === "keep").length;
    const fp = cv.filter((x) => x.expected !== "keep" && x.predicted === "keep").length;
    const fn = cv.filter((x) => x.expected === "keep" && x.predicted !== "keep").length;
    lines.push("", `cross-validated     precision ${pct(tp / (tp + fp))}  recall ${pct(tp / (tp + fn))}  (in-sample numbers above are optimistic)`);
  }
  lines.push("", "mistakes:");
  for (const m of r.mistakes) lines.push(`  ${m.kind.padEnd(13)} ${m.headword.padEnd(18)} ${m.category.padEnd(20)} ${m.difficulty.padEnd(5)} keep ${m.keepScore.toFixed(3)}`);
  return lines.join("\n");
}
