import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadUnlabelledSet, loadUsefulnessDataset } from "../evals/usefulness-datasets.ts";
import type { Disposition } from "./disposition.ts";
import type { AdjudicationRecord } from "./store.ts";
import type { UsefulnessFinding } from "./usefulness/contract.ts";
import type { CandidateMeaning } from "./usefulness/meaning.ts";
import { deriveHeadwordDisposition, verdictOf } from "./usefulness/policy.ts";
import { buildHeadwordSubject, type WordLevelFinding } from "./usefulness/word-level-v13.ts";

const RUNS_DIR = "runs";
const OUTPUT = "reports/usefulness-v9-v13-comparison.html";
const V9 = {
  prompt: "usefulness-prompt/9",
  rubric: "usefulness-rubric/9",
  contract: "usefulness-finding/3",
  policy: "usefulness-policy/2",
  extraction: "usefulness-evidence/1",
} as const;
const V13 = {
  prompt: "usefulness-prompt/13",
  rubric: "usefulness-rubric/11",
  contract: "usefulness-finding/5",
  policy: "usefulness-policy/4",
  extraction: "usefulness-headword-evidence/1",
} as const;
const RUN_CONFIG = {
  deterministicRules: "c5ed5fd4b167c2c2188867f5a6f58db81de96609a2fd60e07ccdb3681b0da01f",
  oewnRelease: "oewn:2025",
  oewnRetrievedVia: "wn 1.1.1",
  wordfreqVersion: "3.1.1",
  wordfreqWordlist: "large",
  candidatePoolPath: "pool.sqlite",
  candidatePool: "a54bb48e144d07108e6f72a0a3f2336b1d8e846e40c958522d969164cd456aa1",
  provider: "openrouter",
  model: "google/gemini-2.5-flash",
  upstream: "google-ai-studio",
  temperature: 0,
  seed: null,
} as const;

type Transition =
  | "v9-kept-v13-dropped"
  | "v13-kept-v9-dropped"
  | "both-kept"
  | "both-dropped"
  | "other";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function matchesRun(
  record: AdjudicationRecord,
  versions: typeof V9 | typeof V13,
): boolean {
  const fingerprint = record.fingerprint;
  return (
    record.gate === "audience-usefulness" &&
    fingerprint.prompt_version === versions.prompt &&
    fingerprint.rubric_version === versions.rubric &&
    fingerprint.contract_version === versions.contract &&
    fingerprint.policy_version === versions.policy &&
    fingerprint.extraction_version === versions.extraction &&
    fingerprint.deterministic_rules_sha256 === RUN_CONFIG.deterministicRules &&
    fingerprint.sources.oewn.release === RUN_CONFIG.oewnRelease &&
    fingerprint.sources.oewn.retrieved_via === RUN_CONFIG.oewnRetrievedVia &&
    fingerprint.sources.wordfreq.version === RUN_CONFIG.wordfreqVersion &&
    fingerprint.sources.wordfreq.wordlist === RUN_CONFIG.wordfreqWordlist &&
    fingerprint.sources.candidate_pool.path === RUN_CONFIG.candidatePoolPath &&
    fingerprint.sources.candidate_pool.sha256 === RUN_CONFIG.candidatePool &&
    fingerprint.provider === RUN_CONFIG.provider &&
    fingerprint.model === RUN_CONFIG.model &&
    fingerprint.upstream_provider === RUN_CONFIG.upstream &&
    fingerprint.temperature === RUN_CONFIG.temperature &&
    fingerprint.seed === RUN_CONFIG.seed
  );
}

function loadRecords<T>(versions: typeof V9 | typeof V13): Map<string, AdjudicationRecord<T>> {
  const records = new Map<string, AdjudicationRecord<T>>();
  for (const name of readdirSync(RUNS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(readFileSync(join(RUNS_DIR, name), "utf8")) as AdjudicationRecord<T>;
    if (!matchesRun(record, versions)) continue;
    const existing = records.get(record.claim_id);
    if (!existing || record.recorded_at > existing.recorded_at) records.set(record.claim_id, record);
  }
  return records;
}

function v9Disposition(records: AdjudicationRecord<UsefulnessFinding>[]): Disposition {
  const verdicts = records
    .map((record) => (record.finding ? verdictOf(record.finding) : undefined))
    .filter((verdict) => verdict !== undefined);
  const failures = records.filter((record) => record.finding === null).length;
  if (failures > 0 && !verdicts.includes("useful")) return "quarantine";
  return deriveHeadwordDisposition(verdicts).disposition;
}

function transitionOf(v9: Disposition, v13: Disposition): Transition {
  if (v9 === "advance" && v13 !== "advance") return "v9-kept-v13-dropped";
  if (v9 !== "advance" && v13 === "advance") return "v13-kept-v9-dropped";
  if (v9 === "advance" && v13 === "advance") return "both-kept";
  if (v9 !== "advance" && v13 !== "advance") return "both-dropped";
  return "other";
}

function decisionLabel(disposition: Disposition): string {
  if (disposition === "advance") return "Keep";
  if (disposition === "exclude") return "Reject";
  return "Quarantine";
}

function main() {
  const golden = loadUsefulnessDataset("usefulness-golden-v3");
  const audit = loadUnlabelledSet("retention-audit-v1");
  const exploration = loadUnlabelledSet("exploration-draw-1");
  const cases = [
    ...golden.cases.map(({ group, expected }) => ({ dataset: "golden", group, expected })),
    ...audit.groups.map((group) => ({ dataset: "audit", group, expected: undefined })),
    ...exploration.groups.map((group) => ({ dataset: "exploration", group, expected: undefined })),
  ];
  const v9Index = loadRecords<UsefulnessFinding>(V9);
  const v13Index = loadRecords<WordLevelFinding>(V13);
  const rows = cases.map(({ dataset, group, expected }) => {
    const v9Records = group.meanings.map((meaning) => {
      const record = v9Index.get(meaning.subject_id);
      if (!record) throw new Error(`no v9 finding for ${meaning.subject_id}`);
      if (record.fingerprint.input_digest !== meaning.input_digest) {
        throw new Error(`v9 input digest mismatch for ${meaning.subject_id}`);
      }
      return { meaning, record };
    });
    const subject = buildHeadwordSubject(group);
    const v13Record = v13Index.get(subject.subject_id);
    if (!v13Record?.finding || !v13Record.effective) {
      throw new Error(`no v13 finding for ${subject.subject_id}`);
    }
    if (v13Record.fingerprint.input_digest !== subject.input_digest) {
      throw new Error(`v13 input digest mismatch for ${subject.subject_id}`);
    }
    const v9 = v9Disposition(v9Records.map(({ record }) => record));
    const v13 = v13Record.effective.disposition;
    return {
      dataset,
      group,
      expected,
      subject,
      v9Records,
      v13Record,
      v9,
      v13,
      transition: transitionOf(v9, v13),
    };
  });

  const transitions = [
    "v9-kept-v13-dropped",
    "v13-kept-v9-dropped",
    "both-kept",
    "both-dropped",
    "other",
  ] as const;
  const counts = Object.fromEntries(
    ["golden", "audit", "exploration"].map((dataset) => [
      dataset,
      Object.fromEntries(
        transitions.map((transition) => [
          transition,
          rows.filter((row) => row.dataset === dataset && row.transition === transition).length,
        ]),
      ),
    ]),
  ) as Record<string, Record<Transition, number>>;
  const summaryHtml = ["golden", "audit", "exploration"]
    .map((dataset) => `<article><h2>${dataset}</h2><b>${counts[dataset]!["v9-kept-v13-dropped"]}</b> v9-only · <b>${counts[dataset]!["v13-kept-v9-dropped"]}</b> v13-only · <b>${counts[dataset]!["both-kept"]}</b> both keep · <b>${counts[dataset]!["both-dropped"]}</b> both drop</article>`)
    .join("");
  const rowsHtml = rows
    .map((row) => {
      const finding = row.v13Record.finding!;
      const humanMatch = row.expected ? row.expected.disposition === row.v13 : undefined;
      const v9Meanings = row.v9Records
        .map(({ meaning, record }) => renderV9Meaning(meaning, record))
        .join("");
      const search = [
        row.group.display,
        finding.rationale,
        row.expected?.why ?? "",
        ...row.v9Records.flatMap(({ meaning, record }) => [
          meaning.meaning.definition,
          record.finding?.rationale ?? "",
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return `<details class="row" data-dataset="${row.dataset}" data-transition="${row.transition}" data-search="${escapeHtml(search)}" data-mismatch="${humanMatch === false}">
        <summary><span><small>${row.dataset}</small><strong>${escapeHtml(row.group.display)}</strong></span><span class="decision ${row.v9}">v9 ${decisionLabel(row.v9)}</span><span class="arrow">→</span><span class="decision ${row.v13}">v13 ${decisionLabel(row.v13)}</span>${row.expected ? `<span class="human ${humanMatch ? "match" : "mismatch"}">Human: ${escapeHtml(row.expected.bucket)}</span>` : `<span class="human">Unlabelled</span>`}<i>+</i></summary>
        <div class="body">${row.expected ? `<p class="owner"><b>Owner's label</b>${escapeHtml(row.expected.why)}</p>` : ""}<div class="columns"><section><h3>V9 · per meaning</h3>${v9Meanings}</section><section><h3>V13 · headword only</h3><p class="properties">${escapeHtml(finding.familiarity.replaceAll("_", " "))} / ${escapeHtml(finding.scope.replaceAll("_", " "))} / ${escapeHtml(finding.learning_value)} value</p><p>${escapeHtml(finding.rationale)}</p><p class="input"><b>Model input</b>word: ${escapeHtml(row.subject.display)}<br>recorded parts of speech: ${escapeHtml(row.subject.parts_of_speech.join(", ") || "none recorded")}</p></section></div></div>
      </details>`;
    })
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WordWell v9 to v13 comparison</title><style>
:root{--ink:#17201d;--muted:#65716c;--paper:#f4f1e8;--panel:#fffdf7;--line:#d8d3c6;--green:#246b4b;--red:#9b3a2c;--amber:#a56a13;--blue:#326785}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.shell{width:min(1280px,calc(100% - 28px));margin:auto;padding:42px 0 80px}.eyebrow,small{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--blue)}h1{max-width:900px;margin:8px 0 18px;font:500 clamp(38px,6vw,68px)/.98 Georgia,serif;letter-spacing:-.04em}.intro{max-width:900px;color:#46514d;font-size:17px;line-height:1.6}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:28px 0}.summary article{padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.summary h2{margin:0 0 9px;color:var(--muted);font-size:12px;text-transform:capitalize}.controls{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr 170px 240px;gap:10px;padding:12px 0;background:color-mix(in srgb,var(--paper) 95%,transparent);backdrop-filter:blur(10px)}input,select{min-height:42px;padding:0 11px;background:var(--panel);border:1px solid var(--line);border-radius:8px;font:inherit}.row{margin-bottom:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}.row[hidden]{display:none}.row>summary{display:grid;grid-template-columns:1fr 100px 24px 110px 140px 24px;gap:10px;align-items:center;min-height:68px;padding:11px 15px;cursor:pointer;list-style:none}.row>summary::-webkit-details-marker{display:none}strong{display:block;font:22px Georgia,serif}.decision{width:max-content;padding:5px 8px;border-radius:6px;font-size:11px;font-weight:800}.advance{color:var(--green);background:#e2f1e7}.exclude{color:var(--red);background:#f8e5df}.quarantine{color:var(--amber);background:#fff0cc}.arrow,.human{color:var(--muted);font-size:12px}.mismatch{color:var(--red);font-weight:800}.body{padding:18px;border-top:1px solid var(--line)}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.columns>section{padding:16px;background:#faf8f1;border:1px solid var(--line);border-radius:10px}.columns h3{margin:0 0 14px;font:20px Georgia,serif}.meaning{margin:0 0 10px;padding-bottom:10px;border-bottom:1px solid var(--line)}.meaning:last-child{border:0}.meaning code,.properties,.input{color:var(--muted);font-size:13px}.meaning p,.columns p{line-height:1.5}.owner{margin:0 0 16px}.owner b,.input b{display:block}.empty{display:none;text-align:center;color:var(--muted);padding:30px}@media(max-width:780px){.summary,.columns{grid-template-columns:1fr}.controls{grid-template-columns:1fr 1fr}.controls input{grid-column:1/3}.row>summary{grid-template-columns:1fr auto auto auto}.human{grid-column:1/5}.row>summary i{display:none}}
</style></head><body><main class="shell"><p class="eyebrow">Audience usefulness · v9 versus v13</p><h1>Which words does the headword gate remove?</h1><p class="intro">V9 judged every dictionary meaning using definitions and examples, then kept the headword when any meaning passed. V13 judged the headword once from the word and its parts of speech. This report defaults to words v9 kept and v13 dropped. Audit and exploration are unlabelled review candidates, not known regressions.</p><section class="summary">${summaryHtml}</section><section class="controls"><input id="search" type="search" placeholder="Search words, definitions, or reasoning"><select id="dataset"><option value="">All datasets</option><option value="golden">Golden</option><option value="audit">Audit</option><option value="exploration">Exploration</option></select><select id="transition"><option value="">All transitions</option><option value="v9-kept-v13-dropped" selected>V9 kept → V13 dropped</option><option value="v13-kept-v9-dropped">V9 dropped → V13 kept</option><option value="both-kept">Both kept</option><option value="both-dropped">Both dropped</option><option value="mismatch">V13 golden mismatches</option></select></section><section>${rowsHtml}</section><p id="empty" class="empty">No words match these filters.</p></main><script>
const rows=[...document.querySelectorAll('.row')],search=document.querySelector('#search'),dataset=document.querySelector('#dataset'),transition=document.querySelector('#transition'),empty=document.querySelector('#empty');function refresh(){const q=search.value.trim().toLowerCase();let visible=0;for(const row of rows){const transitionMatch=!transition.value||(transition.value==='mismatch'?row.dataset.mismatch==='true':row.dataset.transition===transition.value);const show=(!q||row.dataset.search.includes(q))&&(!dataset.value||row.dataset.dataset===dataset.value)&&transitionMatch;row.hidden=!show;if(show)visible++}empty.style.display=visible?'none':'block'}[search,dataset,transition].forEach(control=>control.addEventListener('input',refresh));refresh();
</script></body></html>`;

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUTPUT, html);
  console.log(`${OUTPUT}: ${rows.length} dataset appearances`);
  console.log(JSON.stringify(counts, null, 2));
  for (const dataset of ["golden", "audit", "exploration"]) {
    const dropped = rows.filter(
      (row) => row.dataset === dataset && row.transition === "v9-kept-v13-dropped",
    );
    const words = dropped.map((row) => row.group.display);
    const reasonCounts = new Map<string, number>();
    for (const row of dropped) {
      const reason = `${row.v13Record.finding!.scope}/${row.v13Record.finding!.learning_value}`;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    const reasons = [...reasonCounts.entries()]
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(", ");
    console.log(`${dataset} v9 kept -> v13 dropped (${words.length}): ${words.join(", ")}`);
    console.log(`  v13 properties: ${reasons}`);
    const gained = rows
      .filter((row) => row.dataset === dataset && row.transition === "v13-kept-v9-dropped")
      .map((row) => row.group.display);
    console.log(`${dataset} v9 dropped -> v13 kept (${gained.length}): ${gained.join(", ")}`);
  }
}

function renderV9Meaning(
  meaning: CandidateMeaning,
  record: AdjudicationRecord<UsefulnessFinding>,
): string {
  if (!record.finding) {
    return `<article class="meaning"><code>${escapeHtml(meaning.meaning.sense_id)}</code><p>Contract failure: ${escapeHtml(record.contract_error)}</p></article>`;
  }
  return `<article class="meaning"><code>${escapeHtml(meaning.meaning.sense_id)} · ${escapeHtml(record.finding.exam_level.replaceAll("_", " "))}</code><p><b>${escapeHtml(meaning.meaning.definition)}</b></p><p>${escapeHtml(record.finding.rationale)}</p></article>`;
}

main();
