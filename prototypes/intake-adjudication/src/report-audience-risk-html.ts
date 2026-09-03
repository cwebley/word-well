import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Disposition } from "./disposition.ts";
import type { AdjudicationRecord } from "./store.ts";
import {
  audienceRiskFindingSchema,
  type AudienceRiskFinding,
} from "./audience-risk-v15.ts";

interface CohortRecord {
  lemma: string;
  display: string;
  cohort: "at-risk" | "control" | "v14-keep";
}

const OUTPUT = "reports/usefulness-prompt-15-risk-cohort.html";
const EXTRACTION_VERSION = process.env.RISK_EXTRACTION_VERSION ?? "risk-evidence/1";

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadRecords(): Map<string, AdjudicationRecord<AudienceRiskFinding>> {
  const records = new Map<string, AdjudicationRecord<AudienceRiskFinding>>();
  for (const name of readdirSync("runs")) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(
      readFileSync(join("runs", name), "utf8"),
    ) as AdjudicationRecord<unknown>;
    const result = audienceRiskFindingSchema.safeParse(record.finding);
    if (!result.success) continue;
    if (record.fingerprint.prompt_version !== "usefulness-prompt/15") continue;
    if (record.fingerprint.extraction_version !== EXTRACTION_VERSION) continue;
    records.set(record.claim_id, record as unknown as AdjudicationRecord<AudienceRiskFinding>);
  }
  return records;
}

function dispositionLabel(disposition: Disposition): string {
  if (disposition === "advance") return "Clear";
  if (disposition === "exclude") return "Blocked";
  return "Sensitive (review)";
}

function main() {
  const cohortData = JSON.parse(
    readFileSync("cases/risk-cohort-v1.json", "utf8"),
  ) as { records: CohortRecord[] };
  const perSense = readFileSync("evidence/risk-per-sense.jsonl", "utf8")
    .split(/\n+/)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { lemma: string; wik_first: string[] | null; wik_labels: string[] });
  const lookup = new Map(perSense.map((entry) => [entry.lemma, entry]));

  const records = loadRecords();
  const rows = cohortData.records.map((entry) => {
    const record = records.get(entry.lemma);
    if (!record?.finding || !record.effective) {
      throw new Error(`missing v15 record for ${entry.lemma}`);
    }
    const labels = lookup.get(entry.lemma);
    const wikFirst = labels?.wik_first ?? [];
    const wikLabels = labels?.wik_labels ?? [];
    return { ...entry, record, wikFirst, wikLabels };
  });

  const cohortStats = ["at-risk", "control", "v14-keep"].map((cohort) => {
    const selected = rows.filter((row) => row.cohort === cohort);
    return {
      cohort,
      total: selected.length,
      advance: selected.filter((row) => row.record.effective!.disposition === "advance").length,
      exclude: selected.filter((row) => row.record.effective!.disposition === "exclude").length,
      quarantine: selected.filter((row) => row.record.effective!.disposition === "quarantine").length,
    };
  });

  const summary = cohortStats
    .map(
      (stat) =>
        `<article><h2>${stat.cohort}</h2><b>${stat.advance}</b> clear · <b>${stat.quarantine}</b> sensitive · <b>${stat.exclude}</b> blocked · of <b>${stat.total}</b></article>`,
    )
    .join("");

  const sortedRows = rows.slice().sort((a, b) => {
    const order = ["at-risk", "control", "v14-keep"];
    return order.indexOf(a.cohort) - order.indexOf(b.cohort) || a.lemma.localeCompare(b.lemma);
  });

  const detail = sortedRows
    .map((row) => {
      const finding = row.record.finding!;
      const disposition = row.record.effective!.disposition;
      const search = [
        row.lemma,
        finding.rationale,
        ...row.wikFirst,
        ...row.wikLabels,
      ]
        .join(" ")
        .toLowerCase();
      const wikFirstHtml =
        row.wikFirst.length > 0
          ? `<p class="wik"><b>Wiktionary first-sense labels</b> ${escapeHtml(row.wikFirst.join(", "))}</p>`
          : `<p class="wik"><b>Wiktionary first-sense labels</b> none</p>`;
      const wikAllHtml =
        row.wikLabels.length > 0
          ? `<p class="wik"><b>Wiktionary all-sense labels</b> ${escapeHtml(row.wikLabels.join(", "))}</p>`
          : `<p class="wik"><b>Wiktionary all-sense labels</b> none</p>`;
      return `<details class="row" data-cohort="${row.cohort}" data-disposition="${disposition}" data-search="${escapeHtml(search)}"><summary><span><small>${row.cohort}</small><strong>${escapeHtml(row.display)}</strong></span><span class="result ${disposition}">${dispositionLabel(disposition)}</span><span>${escapeHtml(finding.audience_risk)}</span><span>${escapeHtml(finding.familiarity.replaceAll("_", " "))}</span><i>+</i></summary><div class="body"><p><b>Model input</b> ${escapeHtml(row.display)}</p>${wikFirstHtml}${wikAllHtml}<p><b>Judge's reasoning</b> ${escapeHtml(finding.rationale)}</p></div></details>`;
    })
    .join("");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WordWell v15 audience-risk spike</title><style>
:root{--ink:#17201d;--muted:#65716c;--paper:#f4f1e8;--panel:#fffdf7;--line:#d8d3c6;--green:#246b4b;--red:#9b3a2c;--amber:#a56a13}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.shell{width:min(1180px,calc(100% - 28px));margin:auto;padding:42px 0 80px}.eyebrow,small{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--red)}h1{max-width:900px;margin:8px 0 18px;font:500 clamp(38px,6vw,68px)/.98 Georgia,serif;letter-spacing:-.04em}.intro{max-width:900px;color:#46514d;font-size:17px;line-height:1.6}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:28px 0}.summary article{padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.summary h2{margin:0 0 9px;color:var(--muted);font-size:12px;text-transform:capitalize}.controls{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr 180px 180px;gap:10px;padding:12px 0;background:var(--paper)}input,select{min-height:42px;padding:0 11px;background:var(--panel);border:1px solid var(--line);border-radius:8px;font:inherit}.row{margin-bottom:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}.row[hidden]{display:none}.row>summary{display:grid;grid-template-columns:1fr 150px 110px 100px 24px;gap:13px;align-items:center;min-height:68px;padding:11px 15px;cursor:pointer;list-style:none}.row>summary::-webkit-details-marker{display:none}strong{display:block;font:22px Georgia,serif}.result{width:max-content;padding:5px 8px;border-radius:6px;font-size:11px;font-weight:800}.advance{color:var(--green);background:#e2f1e7}.exclude{color:var(--red);background:#f8e5df}.quarantine{color:var(--amber);background:#fff0cc}.body{padding:2px 18px 18px;border-top:1px solid var(--line);line-height:1.55}.body b{display:block;margin-top:10px}.wik{color:var(--muted);font-size:13px}i{font-style:normal;font-size:20px}.empty{display:none;text-align:center;color:var(--muted);padding:30px}@media(max-width:760px){.summary{grid-template-columns:1fr}.controls{grid-template-columns:1fr 1fr}.controls input{grid-column:1/3}.row>summary{grid-template-columns:1fr auto}.row>summary>span:nth-child(3),.row>summary>span:nth-child(4){grid-column:1/3}.row>summary i{display:none}}
</style></head><body><main class="shell"><p class="eyebrow">Audience usefulness / audience-risk spike v15</p><h1>Did the Wiktionary labels miss anything?</h1><p class="intro">Gemini 2.5 Flash via Google AI Studio, temperature 0. The risk gate saw the headword, its recorded parts of speech, and per-sense Wiktionary labels fetched fresh for this spike. The LLM was asked to use general knowledge to flag risk that the labels missed. Three cohorts: <b>at-risk</b> (sampled from 552 in-band headwords whose Wiktionary labels carry a risk token), <b>control</b> (handpicked words that look risky but aren't), <b>v14-keep</b> (the 110 headwords v14 advanced under usefulness).</p><section class="summary">${summary}</section><section class="controls"><input id="search" type="search" placeholder="Search words or reasoning"><select id="cohort"><option value="">All cohorts</option><option value="at-risk">At-risk (labelled)</option><option value="control">Controls (should be clear)</option><option value="v14-keep">V14 keeps</option></select><select id="disposition"><option value="">All dispositions</option><option value="advance">Clear</option><option value="quarantine">Sensitive</option><option value="exclude">Blocked</option></select></section><section>${detail}</section><p id="empty" class="empty">No words match these filters.</p></main><script>
const rows=[...document.querySelectorAll('.row')],search=document.querySelector('#search'),cohort=document.querySelector('#cohort'),disposition=document.querySelector('#disposition'),empty=document.querySelector('#empty');function refresh(){const q=search.value.trim().toLowerCase();let visible=0;for(const row of rows){const show=(!q||row.dataset.search.includes(q))&&(!cohort.value||row.dataset.cohort===cohort.value)&&(!disposition.value||row.dataset.disposition===disposition.value);row.hidden=!show;if(show)visible++}empty.style.display=visible?'none':'block'}[search,cohort,disposition].forEach(control=>control.addEventListener('input',refresh));refresh();
</script></body></html>`;

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUTPUT, html);
  console.log(`${OUTPUT}: ${rows.length} cohort rows`);
}

main();
