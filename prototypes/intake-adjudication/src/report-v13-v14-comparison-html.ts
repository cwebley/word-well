import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadUnlabelledSet, loadUsefulnessDataset } from "../evals/usefulness-datasets.ts";
import type { AdjudicationRecord } from "./store.ts";
import { buildHeadwordSubject, type WordLevelFinding } from "./usefulness/word-level-v13.ts";

const OUTPUT = "reports/usefulness-v13-v14-comparison.html";
const CONFIGS = {
  v13: { prompt: "usefulness-prompt/13", rubric: "usefulness-rubric/11" },
  v14: { prompt: "usefulness-prompt/14", rubric: "usefulness-rubric/12" },
} as const;
const RUN_CONFIG = {
  deterministicRules: "c5ed5fd4b167c2c2188867f5a6f58db81de96609a2fd60e07ccdb3681b0da01f",
  oewnRelease: "oewn:2025",
  oewnRetrievedVia: "wn 1.1.1",
  wordfreqVersion: "3.1.1",
  wordfreqWordlist: "large",
  candidatePoolPath: "pool.sqlite",
  candidatePool: "a54bb48e144d07108e6f72a0a3f2336b1d8e846e40c958522d969164cd456aa1",
} as const;

type Version = keyof typeof CONFIGS;
type Transition = "v13-only" | "v14-only" | "both-keep" | "both-drop";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadRecords(version: Version): Map<string, AdjudicationRecord<WordLevelFinding>> {
  const config = CONFIGS[version];
  const records = new Map<string, AdjudicationRecord<WordLevelFinding>>();
  for (const name of readdirSync("runs")) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(
      readFileSync(join("runs", name), "utf8"),
    ) as AdjudicationRecord<WordLevelFinding>;
    if (
      record.gate !== "audience-usefulness" ||
      record.fingerprint.prompt_version !== config.prompt ||
      record.fingerprint.rubric_version !== config.rubric ||
      record.fingerprint.contract_version !== "usefulness-finding/5" ||
      record.fingerprint.policy_version !== "usefulness-policy/4" ||
      record.fingerprint.extraction_version !== "usefulness-headword-evidence/1" ||
      record.fingerprint.deterministic_rules_sha256 !== RUN_CONFIG.deterministicRules ||
      record.fingerprint.sources.oewn.release !== RUN_CONFIG.oewnRelease ||
      record.fingerprint.sources.oewn.retrieved_via !== RUN_CONFIG.oewnRetrievedVia ||
      record.fingerprint.sources.wordfreq.version !== RUN_CONFIG.wordfreqVersion ||
      record.fingerprint.sources.wordfreq.wordlist !== RUN_CONFIG.wordfreqWordlist ||
      record.fingerprint.sources.candidate_pool.path !== RUN_CONFIG.candidatePoolPath ||
      record.fingerprint.sources.candidate_pool.sha256 !== RUN_CONFIG.candidatePool ||
      record.fingerprint.provider !== "openrouter" ||
      record.fingerprint.model !== "google/gemini-2.5-flash" ||
      record.fingerprint.upstream_provider !== "google-ai-studio" ||
      record.fingerprint.temperature !== 0 ||
      record.fingerprint.seed !== null
    ) {
      continue;
    }
    records.set(record.claim_id, record);
  }
  return records;
}

function transitionOf(v13: boolean, v14: boolean): Transition {
  if (v13 && !v14) return "v13-only";
  if (!v13 && v14) return "v14-only";
  return v13 ? "both-keep" : "both-drop";
}

function findingHtml(version: Version, record: AdjudicationRecord<WordLevelFinding>): string {
  const finding = record.finding!;
  const disposition = record.effective!.disposition;
  return `<section><h3>${version.toUpperCase()} <span class="decision ${disposition}">${disposition === "advance" ? "Keep" : disposition === "exclude" ? "Reject" : "Quarantine"}</span></h3><p class="properties">${escapeHtml(finding.familiarity.replaceAll("_", " "))} / ${escapeHtml(finding.scope.replaceAll("_", " "))} / ${escapeHtml(finding.learning_value)} value</p><p>${escapeHtml(finding.rationale)}</p></section>`;
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
  const indexes = { v13: loadRecords("v13"), v14: loadRecords("v14") };
  const rows = cases.map(({ dataset, group, expected }) => {
    const subject = buildHeadwordSubject(group);
    const v13 = indexes.v13.get(subject.subject_id);
    const v14 = indexes.v14.get(subject.subject_id);
    if (!v13?.finding || !v13.effective || !v14?.finding || !v14.effective) {
      throw new Error(`missing headword finding for ${subject.subject_id}`);
    }
    if (
      v13.fingerprint.input_digest !== subject.input_digest ||
      v14.fingerprint.input_digest !== subject.input_digest
    ) {
      throw new Error(`input digest mismatch for ${subject.subject_id}`);
    }
    const transition = transitionOf(
      v13.effective.disposition === "advance",
      v14.effective.disposition === "advance",
    );
    return { dataset, group, expected, v13, v14, transition };
  });
  const datasets = ["golden", "audit", "exploration"];
  const transitions: Transition[] = ["v13-only", "v14-only", "both-keep", "both-drop"];
  const counts = Object.fromEntries(
    datasets.map((dataset) => [
      dataset,
      Object.fromEntries(
        transitions.map((transition) => [
          transition,
          rows.filter((row) => row.dataset === dataset && row.transition === transition).length,
        ]),
      ),
    ]),
  ) as Record<string, Record<Transition, number>>;
  const summaries = datasets
    .map((dataset) => `<article><h2>${dataset}</h2><b>${counts[dataset]!["v13-only"]}</b> v13-only · <b>${counts[dataset]!["v14-only"]}</b> v14-only · <b>${counts[dataset]!["both-keep"]}</b> both keep · <b>${counts[dataset]!["both-drop"]}</b> both drop</article>`)
    .join("");
  const rowsHtml = rows
    .map((row) => {
      const changed = row.transition === "v13-only" || row.transition === "v14-only";
      const v14Matches = row.expected
        ? row.v14.effective!.disposition === row.expected.disposition
        : undefined;
      const search = `${row.group.display} ${row.v13.finding!.rationale} ${row.v14.finding!.rationale} ${row.expected?.why ?? ""}`.toLowerCase();
      return `<details class="row" data-dataset="${row.dataset}" data-transition="${row.transition}" data-changed="${changed}" data-search="${escapeHtml(search)}" data-mismatch="${v14Matches === false}"><summary><span><small>${row.dataset}</small><strong>${escapeHtml(row.group.display)}</strong></span><span class="transition">${escapeHtml(row.transition.replaceAll("-", " "))}</span>${row.expected ? `<span class="human ${v14Matches ? "match" : "mismatch"}">Human: ${escapeHtml(row.expected.bucket)}</span>` : `<span class="human">Unlabelled</span>`}<i>+</i></summary><div class="body">${row.expected ? `<p class="owner"><b>Owner's label</b>${escapeHtml(row.expected.why)}</p>` : ""}<div class="columns">${findingHtml("v13", row.v13)}${findingHtml("v14", row.v14)}</div></div></details>`;
    })
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WordWell v13 to v14 comparison</title><style>
:root{--ink:#17201d;--muted:#65716c;--paper:#f4f1e8;--panel:#fffdf7;--line:#d8d3c6;--green:#246b4b;--red:#9b3a2c;--amber:#a56a13;--blue:#326785}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.shell{width:min(1200px,calc(100% - 28px));margin:auto;padding:42px 0 80px}.eyebrow,small{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--blue)}h1{max-width:900px;margin:8px 0 18px;font:500 clamp(38px,6vw,68px)/.98 Georgia,serif;letter-spacing:-.04em}.intro{max-width:900px;color:#46514d;font-size:17px;line-height:1.6}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:28px 0}.summary article{padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.summary h2{margin:0 0 9px;color:var(--muted);font-size:12px;text-transform:capitalize}.controls{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr 180px 190px;gap:10px;padding:12px 0;background:color-mix(in srgb,var(--paper) 95%,transparent);backdrop-filter:blur(10px)}input,select{min-height:42px;padding:0 11px;background:var(--panel);border:1px solid var(--line);border-radius:8px;font:inherit}.row{margin-bottom:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}.row[hidden]{display:none}.row>summary{display:grid;grid-template-columns:1fr 180px 145px 24px;gap:12px;align-items:center;min-height:68px;padding:11px 15px;cursor:pointer;list-style:none}.row>summary::-webkit-details-marker{display:none}strong{display:block;font:22px Georgia,serif}.transition,.human,.properties{color:var(--muted);font-size:13px}.mismatch{color:var(--red);font-weight:800}.body{padding:18px;border-top:1px solid var(--line)}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.columns>section{padding:16px;background:#faf8f1;border:1px solid var(--line);border-radius:10px}.columns h3{margin:0 0 14px;font:20px Georgia,serif}.columns p{line-height:1.55}.decision{display:inline-block;margin-left:8px;padding:4px 7px;border-radius:6px;font:800 11px Inter,sans-serif}.advance{color:var(--green);background:#e2f1e7}.exclude{color:var(--red);background:#f8e5df}.quarantine{color:var(--amber);background:#fff0cc}.owner{margin:0 0 16px}.owner b{display:block}.empty{display:none;text-align:center;color:var(--muted);padding:30px}@media(max-width:760px){.summary,.columns{grid-template-columns:1fr}.controls{grid-template-columns:1fr 1fr}.controls input{grid-column:1/3}.row>summary{grid-template-columns:1fr auto}.human{grid-column:1/3}.row>summary i{display:none}}
</style></head><body><main class="shell"><p class="eyebrow">Audience usefulness · v13 versus v14</p><h1>What changed when the prompt got smaller?</h1><p class="intro">Both versions judged the same headword and parts of speech with the same model, finding schema, and deterministic policy. Only the system rubric changed. This report defaults to changed dispositions; audit and exploration remain unlabelled.</p><section class="summary">${summaries}</section><section class="controls"><input id="search" type="search" placeholder="Search words or reasoning"><select id="dataset"><option value="">All datasets</option><option value="golden">Golden</option><option value="audit">Audit</option><option value="exploration">Exploration</option></select><select id="transition"><option value="changed" selected>Changed dispositions</option><option value="">All dispositions</option><option value="v13-only">V13 kept only</option><option value="v14-only">V14 kept only</option><option value="both-keep">Both kept</option><option value="both-drop">Both dropped</option><option value="mismatch">V14 golden mismatches</option></select></section><section>${rowsHtml}</section><p id="empty" class="empty">No words match these filters.</p></main><script>
const rows=[...document.querySelectorAll('.row')],search=document.querySelector('#search'),dataset=document.querySelector('#dataset'),transition=document.querySelector('#transition'),empty=document.querySelector('#empty');function refresh(){const q=search.value.trim().toLowerCase();let visible=0;for(const row of rows){const t=transition.value,transitionMatch=!t||(t==='changed'?row.dataset.changed==='true':t==='mismatch'?row.dataset.mismatch==='true':row.dataset.transition===t);const show=(!q||row.dataset.search.includes(q))&&(!dataset.value||row.dataset.dataset===dataset.value)&&transitionMatch;row.hidden=!show;if(show)visible++}empty.style.display=visible?'none':'block'}[search,dataset,transition].forEach(control=>control.addEventListener('input',refresh));refresh();
</script></body></html>`;

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUTPUT, html);
  console.log(`${OUTPUT}: ${rows.length} dataset appearances`);
  console.log(JSON.stringify(counts, null, 2));
  for (const dataset of datasets) {
    for (const transition of ["v13-only", "v14-only"] as const) {
      const words = rows
        .filter((row) => row.dataset === dataset && row.transition === transition)
        .map((row) => row.group.display);
      console.log(`${dataset} ${transition} (${words.length}): ${words.join(", ")}`);
    }
  }
}

main();
