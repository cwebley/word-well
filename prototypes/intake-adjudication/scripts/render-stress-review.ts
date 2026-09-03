// Local-only report for reviewing the corrected V14/V15 stress runs.
// It reads persisted records and makes no model calls.

import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { audienceRiskFindingSchema, audienceRiskDisposition, type AudienceRiskFinding } from "../src/audience-risk-v15.ts";
import { wordLevelFindingSchema, type WordLevelFinding } from "../src/usefulness/word-level-v13.ts";

const COHORT_PATH = "cases/risk-stress-cohort-v1.json";
const OUTPUT = "reports/risk-stress-human-review.html";
const V14_EXTRACTION = "usefulness-headword-evidence-stress/2";
const V15_EXTRACTION = "risk-evidence-stress/2";

interface CohortRecord {
  lemma: string;
  display: string;
  cohort: string;
  pos?: string[];
  zipf_summed?: number;
  endorsements?: number;
}

interface StoredRecord<Finding> {
  claim_id: string;
  finding: Finding | null;
  effective: { disposition: string } | null;
  contract_error: string | null;
  fingerprint: { extraction_version: string };
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadRecords<Finding>(extractionVersion: string): Map<string, StoredRecord<Finding>> {
  const records = new Map<string, StoredRecord<Finding>>();
  for (const name of readdirSync("runs")) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(readFileSync(join("runs", name), "utf8")) as StoredRecord<unknown>;
    if (record.fingerprint?.extraction_version !== extractionVersion) continue;
    records.set(record.claim_id, record as StoredRecord<Finding>);
  }
  return records;
}

function label(disposition: string): string {
  if (disposition === "advance") return "advance";
  if (disposition === "exclude") return "exclude";
  return "quarantine";
}

const cohort = (JSON.parse(readFileSync(COHORT_PATH, "utf8")) as { records: CohortRecord[] }).records;
const v14 = loadRecords<WordLevelFinding>(V14_EXTRACTION);
const v15 = loadRecords<AudienceRiskFinding>(V15_EXTRACTION);

const rows = cohort.map((entry) => {
  const usefulness = v14.get(entry.lemma);
  const risk = v15.get(entry.lemma);
  if (!usefulness?.finding || !risk?.finding || !usefulness.effective || !risk.effective) {
    throw new Error(`incomplete stress records for ${entry.lemma}`);
  }
  if (usefulness.contract_error || risk.contract_error) {
    throw new Error(`contract error in corrected stress records for ${entry.lemma}`);
  }
  return { entry, usefulness, risk };
});

const dispositionFor = (row: (typeof rows)[number], field: "usefulness" | "risk") =>
  field === "risk"
    ? audienceRiskDisposition(row.risk.finding!).disposition
    : row.usefulness.effective!.disposition;

const stats = (field: "usefulness" | "risk") =>
  ["advance", "exclude", "quarantine"]
    .map((disposition) => ({
      disposition,
      count: rows.filter((row) => dispositionFor(row, field) === disposition).length,
    }));

const detail = rows
  .slice()
  .sort((a, b) => a.entry.lemma.localeCompare(b.entry.lemma))
  .map(({ entry, usefulness, risk }) => {
    const v14Finding = usefulness.finding!;
    const v15Finding = risk.finding!;
    const v14Disposition = label(usefulness.effective!.disposition);
    const v15Disposition = label(audienceRiskDisposition(v15Finding).disposition);
    const search = [
      entry.lemma,
      v14Disposition,
      v15Disposition,
      v15Finding.audience_risk,
      v14Finding.rationale,
      v15Finding.rationale,
    ]
      .join(" ")
      .toLowerCase();
    return `<details class="row" data-search="${escapeHtml(search)}" data-v14="${v14Disposition}" data-v15="${v15Disposition}"><summary><strong>${escapeHtml(entry.display)}</strong><span class="${v14Disposition}">V14 ${v14Disposition}</span><span class="${v15Disposition}">V15 ${v15Disposition}</span><i>+</i></summary><div class="body"><p><b>Recorded parts of speech</b> ${escapeHtml(entry.pos?.join(", ") || "none")}</p><section><h3>V14 usefulness</h3><p>${escapeHtml(v14Finding.familiarity)} / ${escapeHtml(v14Finding.scope)} / ${escapeHtml(v14Finding.learning_value)}</p><p>${escapeHtml(v14Finding.rationale)}</p></section><section><h3>V15 audience risk</h3><p>${escapeHtml(v15Finding.familiarity)} / ${escapeHtml(v15Finding.audience_risk)}</p><p>${escapeHtml(v15Finding.rationale)}</p></section></div></details>`;
  })
  .join("");

const v14Stats = stats("usefulness");
const v15Stats = stats("risk");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WordWell risk stress human review</title><style>
:root{--ink:#17201d;--muted:#65716c;--paper:#f4f1e8;--panel:#fffdf7;--line:#d8d3c6;--green:#246b4b;--red:#9b3a2c;--amber:#a56a13}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.shell{width:min(1180px,calc(100% - 28px));margin:auto;padding:36px 0 70px}h1{font:500 clamp(34px,5vw,58px)/1 Georgia,serif;margin:0 0 12px}.intro{max-width:900px;color:#46514d;line-height:1.55}.summary{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:24px 0}.summary article{padding:16px 18px;background:var(--panel);border:1px solid var(--line);border-radius:10px}.summary h2{font-size:14px;margin:0 0 8px}.stats{display:flex;gap:12px;flex-wrap:wrap}.stats span{font-size:13px}.controls{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr 180px 180px;gap:10px;padding:12px 0;background:var(--paper)}input,select{min-height:40px;padding:0 10px;background:var(--panel);border:1px solid var(--line);border-radius:7px;font:inherit}.row{margin:0 0 8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}.row[hidden]{display:none}.row>summary{display:grid;grid-template-columns:1fr 140px 140px 24px;gap:12px;align-items:center;padding:12px 15px;cursor:pointer;list-style:none}.row>summary::-webkit-details-marker{display:none}strong{font:21px Georgia,serif}.row span{width:max-content;padding:5px 7px;border-radius:5px;font-size:11px;font-weight:800}.advance{color:var(--green);background:#e2f1e7}.exclude{color:var(--red);background:#f8e5df}.quarantine{color:var(--amber);background:#fff0cc}.body{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:4px 18px 18px;border-top:1px solid var(--line);line-height:1.5}.body section{border-top:2px solid var(--line)}.body b,.body h3{display:block;margin-top:12px}.body h3{font-size:14px}.body p{margin:8px 0}.note{font-size:13px;color:var(--muted)}@media(max-width:700px){.summary,.body{grid-template-columns:1fr}.controls{grid-template-columns:1fr}.row>summary{grid-template-columns:1fr 110px 110px 18px}.row span{font-size:10px}}
</style></head><body><main class="shell"><h1>307-word stress review</h1><p class="intro">Local-only comparison of the corrected V14 usefulness run and V15 audience-risk run. These words came from Wiktionary offensive-category membership but that category signal was withheld from both judges. This is a challenge cohort, not a prevalence estimate. Both runs had zero contract errors.</p><section class="summary"><article><h2>V14 usefulness</h2><div class="stats">${v14Stats.map((stat) => `<span class="${stat.disposition}">${stat.count} ${stat.disposition}</span>`).join("")}</div></article><article><h2>V15 audience risk</h2><div class="stats">${v15Stats.map((stat) => `<span class="${stat.disposition}">${stat.count} ${stat.disposition}</span>`).join("")}</div></article></section><p class="note">Review V15 first. "Exclude" means the model judged ordinary usage blocked; "quarantine" means boundary or sensitive; "advance" means clear. Then compare V14 to see whether usefulness would have stopped the word earlier.</p><section class="controls"><input id="search" type="search" placeholder="Search word or rationale"><select id="v14"><option value="">All V14 decisions</option><option>advance</option><option>exclude</option><option>quarantine</option></select><select id="v15"><option value="">All V15 decisions</option><option>advance</option><option>exclude</option><option>quarantine</option></select></section><section id="rows">${detail}</section><p id="empty" hidden>No rows match these filters.</p></main><script>const rows=[...document.querySelectorAll('.row')],search=document.querySelector('#search'),v14=document.querySelector('#v14'),v15=document.querySelector('#v15'),empty=document.querySelector('#empty');function refresh(){const q=search.value.trim().toLowerCase();let visible=0;for(const row of rows){const show=(!q||row.dataset.search.includes(q))&&(!v14.value||row.dataset.v14===v14.value)&&(!v15.value||row.dataset.v15===v15.value);row.hidden=!show;if(show)visible++}empty.hidden=visible>0}for(const control of [search,v14,v15])control.addEventListener('input',refresh);refresh();</script></body></html>`;

mkdirSync("reports", { recursive: true });
writeFileSync(OUTPUT, html);
console.log(`${OUTPUT}: ${rows.length} rows`);
