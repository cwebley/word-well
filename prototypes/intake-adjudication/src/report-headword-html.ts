import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadUnlabelledSet, loadUsefulnessDataset } from "../evals/usefulness-datasets.ts";
import type { Disposition } from "./disposition.ts";
import type { AdjudicationRecord } from "./store.ts";
import { buildHeadwordSubject, type WordLevelFinding } from "./usefulness/word-level-v13.ts";

const RUNS_DIR = "runs";
const PROMPT_NUMBER = process.env.PROMPT_NUMBER ?? "13";
if (PROMPT_NUMBER !== "13" && PROMPT_NUMBER !== "14") {
  throw new Error(`unsupported headword report prompt: ${PROMPT_NUMBER}`);
}
const REPORT_DATASETS = process.env.REPORT_DATASETS;
if (REPORT_DATASETS && REPORT_DATASETS !== "retention-audit-v1") {
  throw new Error(`unsupported headword report dataset: ${REPORT_DATASETS}`);
}
const AUDIT_ONLY = REPORT_DATASETS === "retention-audit-v1";
if (AUDIT_ONLY && PROMPT_NUMBER !== "14") {
  throw new Error("the retention audit report is only available for prompt 14");
}
const OUTPUT = AUDIT_ONLY
  ? "reports/usefulness-prompt-14-retention-audit-v1.html"
  : `reports/usefulness-prompt-${PROMPT_NUMBER}-all-sets.html`;
const VERSIONS = {
  prompt: `usefulness-prompt/${PROMPT_NUMBER}`,
  rubric: PROMPT_NUMBER === "14" ? "usefulness-rubric/12" : "usefulness-rubric/11",
  contract: "usefulness-finding/5",
  policy: "usefulness-policy/4",
} as const;
const RUN_CONFIG = {
  extraction: "usefulness-headword-evidence/1",
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

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadRecords(): Map<string, AdjudicationRecord<WordLevelFinding>> {
  const records = new Map<string, AdjudicationRecord<WordLevelFinding>>();
  for (const name of readdirSync(RUNS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(
      readFileSync(join(RUNS_DIR, name), "utf8"),
    ) as AdjudicationRecord<WordLevelFinding>;
    const fingerprint = record.fingerprint;
    if (
      record.gate !== "audience-usefulness" ||
      fingerprint.prompt_version !== VERSIONS.prompt ||
      fingerprint.rubric_version !== VERSIONS.rubric ||
      fingerprint.contract_version !== VERSIONS.contract ||
      fingerprint.policy_version !== VERSIONS.policy ||
      fingerprint.extraction_version !== RUN_CONFIG.extraction ||
      fingerprint.deterministic_rules_sha256 !== RUN_CONFIG.deterministicRules ||
      fingerprint.sources.oewn.release !== RUN_CONFIG.oewnRelease ||
      fingerprint.sources.oewn.retrieved_via !== RUN_CONFIG.oewnRetrievedVia ||
      fingerprint.sources.wordfreq.version !== RUN_CONFIG.wordfreqVersion ||
      fingerprint.sources.wordfreq.wordlist !== RUN_CONFIG.wordfreqWordlist ||
      fingerprint.sources.candidate_pool.path !== RUN_CONFIG.candidatePoolPath ||
      fingerprint.sources.candidate_pool.sha256 !== RUN_CONFIG.candidatePool ||
      fingerprint.provider !== RUN_CONFIG.provider ||
      fingerprint.model !== RUN_CONFIG.model ||
      fingerprint.upstream_provider !== RUN_CONFIG.upstream ||
      fingerprint.temperature !== RUN_CONFIG.temperature ||
      fingerprint.seed !== RUN_CONFIG.seed
    ) {
      continue;
    }
    records.set(record.claim_id, record);
  }
  return records;
}

function resultLabel(disposition: Disposition): string {
  if (disposition === "advance") return "Keep";
  if (disposition === "exclude") return "Reject";
  return "Quarantine";
}

function main() {
  const golden = loadUsefulnessDataset("usefulness-golden-v3");
  const audit = loadUnlabelledSet("retention-audit-v1");
  const exploration = loadUnlabelledSet("exploration-draw-1");
  const cases = AUDIT_ONLY
    ? audit.groups.map((group) => ({ dataset: "audit", group, expected: undefined }))
    : [
        ...golden.cases.map(({ group, expected }) => ({ dataset: "golden", group, expected })),
        ...audit.groups.map((group) => ({ dataset: "audit", group, expected: undefined })),
        ...exploration.groups.map((group) => ({ dataset: "exploration", group, expected: undefined })),
      ];
  const records = loadRecords();
  const rows = cases.map(({ dataset, group, expected }) => {
    const subject = buildHeadwordSubject(group);
    const record = records.get(subject.subject_id);
    if (!record?.finding || !record.effective) {
      throw new Error(`no ${VERSIONS.prompt} finding for ${subject.subject_id}`);
    }
    if (record.fingerprint.input_digest !== subject.input_digest) {
      throw new Error(`input digest mismatch for ${subject.subject_id}`);
    }
    return { dataset, group, expected, subject, record };
  });

  const summaries = ["golden", "audit", "exploration"].map((dataset) => {
    const selected = rows.filter((row) => row.dataset === dataset);
    return {
      dataset,
      total: selected.length,
      kept: selected.filter((row) => row.record.effective!.disposition === "advance").length,
      rejected: selected.filter((row) => row.record.effective!.disposition === "exclude").length,
      quarantined: selected.filter((row) => row.record.effective!.disposition === "quarantine").length,
      correct: selected.filter(
        (row) => row.expected?.disposition === row.record.effective!.disposition,
      ).length,
    };
  });
  const auditSummary = summaries.find((summary) => summary.dataset === "audit")!;
  const retention = Math.round((auditSummary.kept / auditSummary.total) * 100);
  const summaryHtml = AUDIT_ONLY
    ? `<article><h2>retention audit v1</h2><b>${retention}%</b> retention · <b>${auditSummary.kept}/${auditSummary.total}</b> editorially endorsed words kept · no accuracy score</article>`
    : summaries
        .map(
          (summary) => `<article><h2>${summary.dataset}</h2><b>${summary.kept}</b> kept · <b>${summary.rejected}</b> rejected${summary.quarantined ? ` · <b>${summary.quarantined}</b> quarantined` : ""}${summary.dataset === "golden" ? ` · <b>${summary.correct}/${summary.total}</b> match` : ""}</article>`,
        )
        .join("");
  const rowsHtml = rows
    .map(({ dataset, group, expected, subject, record }) => {
      const finding = record.finding!;
      const disposition = record.effective!.disposition;
      const agrees = expected ? expected.disposition === disposition : undefined;
      const search = `${group.display} ${finding.rationale} ${expected?.why ?? ""}`.toLowerCase();
      return `<details class="row" data-dataset="${dataset}" data-result="${disposition}" data-search="${escapeHtml(search)}" data-mismatch="${agrees === false}">
        <summary><span><small>${dataset}</small><strong>${escapeHtml(group.display)}</strong></span><span class="result ${disposition}">${resultLabel(disposition)}</span><span>${escapeHtml(finding.familiarity.replaceAll("_", " "))} / ${escapeHtml(finding.scope.replaceAll("_", " "))} / ${escapeHtml(finding.learning_value)} value</span>${expected ? `<span class="human ${agrees ? "match" : "mismatch"}">Human: ${escapeHtml(expected.bucket)}</span>` : `<span class="human">${AUDIT_ONLY ? "Editorially endorsed · unlabelled" : "Unlabelled"}</span>`}<i>+</i></summary>
        <div class="body">${expected ? `<p><b>Owner's label</b> ${escapeHtml(expected.why)}</p>` : ""}<p><b>Model input</b> ${escapeHtml(subject.display)} · parts of speech: ${escapeHtml(subject.parts_of_speech.join(", "))}</p><p><b>Judge's reasoning</b> ${escapeHtml(finding.rationale)}</p></div>
      </details>`;
    })
    .join("");

  const title = AUDIT_ONLY
    ? "WordWell prompt v14 retention audit"
    : `WordWell prompt v${PROMPT_NUMBER} review`;
  const eyebrow = AUDIT_ONLY
    ? "Audience usefulness / headword-level prompt v14 / retention audit v1"
    : `Audience usefulness / headword-level prompt v${PROMPT_NUMBER}`;
  const heading = AUDIT_ONLY
    ? "How many endorsed words did v14 retain?"
    : "Does the word reward deliberate study?";
  const intro = AUDIT_ONLY
    ? `These 100 words are editorially endorsed and deliberately unlabelled: none has a human keep/reject verdict. The <b>${retention}%</b> result is retention, not accuracy. Gemini 2.5 Flash judged each headword from only the word and its recorded parts of speech; definitions, examples, synonyms, frequency, sense IDs, labels, and endorsements were not shown.`
    : "Gemini 2.5 Flash via Google AI Studio, temperature 0. One call per headword, using only the word and its recorded parts of speech. Definitions, examples, synonyms, frequency, sense IDs, labels, and endorsements were not shown. Policy kept general, high-value words; familiarity was informative rather than an automatic veto.";
  const datasetOptions = AUDIT_ONLY
    ? '<option value="audit">Retention audit v1 only</option>'
    : '<option value="">All datasets</option><option value="golden">Golden</option><option value="audit">Audit</option><option value="exploration">Exploration</option>';
  const resultOptions = AUDIT_ONLY
    ? '<option value="">All results</option><option value="advance">Kept</option><option value="exclude">Rejected</option><option value="quarantine">Quarantined</option>'
    : '<option value="">All results</option><option value="advance">Kept</option><option value="exclude">Rejected</option><option value="quarantine">Quarantined</option><option value="mismatch">Golden mismatches</option>';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
:root{--ink:#17201d;--muted:#65716c;--paper:#f4f1e8;--panel:#fffdf7;--line:#d8d3c6;--green:#246b4b;--red:#9b3a2c;--amber:#a56a13}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,sans-serif}.shell{width:min(1180px,calc(100% - 28px));margin:auto;padding:42px 0 80px}.eyebrow,small{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase;color:var(--green)}h1{max-width:850px;margin:8px 0 18px;font:500 clamp(38px,6vw,68px)/.98 Georgia,serif;letter-spacing:-.04em}.intro{max-width:850px;color:#46514d;font-size:17px;line-height:1.6}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:28px 0}.summary.audit-summary{grid-template-columns:1fr}.summary article{padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.summary h2{margin:0 0 9px;color:var(--muted);font-size:12px;text-transform:capitalize}.controls{position:sticky;top:0;z-index:2;display:grid;grid-template-columns:1fr 180px 180px;gap:10px;padding:12px 0;background:var(--paper)}input,select{min-height:42px;padding:0 11px;background:var(--panel);border:1px solid var(--line);border-radius:8px;font:inherit}.row{margin-bottom:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}.row[hidden]{display:none}.row>summary{display:grid;grid-template-columns:1fr 90px 2fr 145px 24px;gap:13px;align-items:center;min-height:68px;padding:11px 15px;cursor:pointer;list-style:none}.row>summary::-webkit-details-marker{display:none}strong{display:block;font:22px Georgia,serif}.result{width:max-content;padding:5px 8px;border-radius:6px;font-size:11px;font-weight:800}.advance{color:var(--green);background:#e2f1e7}.exclude{color:var(--red);background:#f8e5df}.quarantine{color:var(--amber);background:#fff0cc}.human{color:var(--muted);font-size:12px}.mismatch{color:var(--red);font-weight:800}.body{padding:2px 18px 18px;border-top:1px solid var(--line);line-height:1.55}.body b{display:block;margin-top:15px}i{font-style:normal;font-size:20px}.empty{display:none;text-align:center;color:var(--muted);padding:30px}@media(max-width:760px){.summary{grid-template-columns:1fr}.controls{grid-template-columns:1fr 1fr}.controls input{grid-column:1/3}.row>summary{grid-template-columns:1fr auto}.row>summary>span:nth-child(3),.human{grid-column:1/3}.row>summary i{display:none}}
</style></head><body><main class="shell"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><p class="intro">${intro}</p><section class="summary${AUDIT_ONLY ? " audit-summary" : ""}">${summaryHtml}</section><section class="controls"><input id="search" type="search" placeholder="Search words or reasoning"><select id="dataset">${datasetOptions}</select><select id="result">${resultOptions}</select></section><section>${rowsHtml}</section><p id="empty" class="empty">No words match these filters.</p></main><script>
const rows=[...document.querySelectorAll('.row')],search=document.querySelector('#search'),dataset=document.querySelector('#dataset'),result=document.querySelector('#result'),empty=document.querySelector('#empty');function refresh(){const q=search.value.trim().toLowerCase();let visible=0;for(const row of rows){const resultMatch=!result.value||(result.value==='mismatch'?row.dataset.mismatch==='true':row.dataset.result===result.value);const show=(!q||row.dataset.search.includes(q))&&(!dataset.value||row.dataset.dataset===dataset.value)&&resultMatch;row.hidden=!show;if(show)visible++}empty.style.display=visible?'none':'block'}[search,dataset,result].forEach(control=>control.addEventListener('input',refresh));refresh();
</script></body></html>`;

  mkdirSync("reports", { recursive: true });
  writeFileSync(OUTPUT, html);
  console.log(
    AUDIT_ONLY
      ? `${OUTPUT}: ${rows.length} audit rows`
      : `${OUTPUT}: ${rows.length} dataset appearances, ${records.size} headword calls`,
  );
}

main();
