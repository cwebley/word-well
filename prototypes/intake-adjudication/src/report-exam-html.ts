import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadUnlabelledSet } from "../evals/usefulness-datasets.ts";
import { RUNS_DIR } from "./config.ts";
import type { AdjudicationRecord } from "./store.ts";
import type { UsefulnessFinding } from "./usefulness/contract.ts";
import { examLevelValues } from "./usefulness/contract.ts";
import { usefulnessGate } from "./usefulness/gate.ts";
import { evidenceItems } from "./usefulness/meaning.ts";
import { deriveHeadwordDisposition, verdictOf } from "./usefulness/policy.ts";

const CASE_SET = process.env.CASE_SET ?? "exploration-draw-1";
const REPORTS_DIR = "reports";
type ExamLevel = UsefulnessFinding["exam_level"];

const LEVEL_LABEL = {
  ordinary: "Ordinary",
  middle_school: "Middle school",
  high_school: "High school",
  college: "College",
  postgraduate: "Postgraduate",
  specialist_subject: "Specialist subject",
  insufficient_evidence: "Insufficient evidence",
} as const;

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadRecords(): Map<string, AdjudicationRecord<UsefulnessFinding>> {
  const records = new Map<string, AdjudicationRecord<UsefulnessFinding>>();
  for (const name of readdirSync(RUNS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(
      readFileSync(join(RUNS_DIR, name), "utf8"),
    ) as AdjudicationRecord<UsefulnessFinding>;
    if (record.gate !== usefulnessGate.name) continue;
    if (
      record.fingerprint.prompt_version !== usefulnessGate.versions.prompt ||
      record.fingerprint.rubric_version !== usefulnessGate.versions.rubric ||
      record.fingerprint.contract_version !== usefulnessGate.versions.contract ||
      record.fingerprint.policy_version !== usefulnessGate.versions.policy
    ) {
      continue;
    }
    const existing = records.get(record.claim_id);
    if (!existing || record.recorded_at > existing.recorded_at) records.set(record.claim_id, record);
  }
  return records;
}

function main() {
  const set = loadUnlabelledSet(CASE_SET);
  const records = loadRecords();
  const levelTotals = Object.fromEntries(
    examLevelValues.map((value) => [value, 0]),
  ) as Record<ExamLevel, number>;

  const rows = set.groups.map((group) => {
    const paired = group.meanings.map((subject) => {
      const record = records.get(subject.subject_id);
      if (!record?.finding) {
        throw new Error(`no ${usefulnessGate.versions.prompt} finding for ${subject.subject_id}`);
      }
      if (record.fingerprint.input_digest !== subject.input_digest) {
        throw new Error(`input digest mismatch for ${subject.subject_id}`);
      }
      levelTotals[record.finding.exam_level] += 1;
      return { subject, record };
    });
    const verdicts = paired.map(({ record }) => verdictOf(record.finding!));
    const disposition = deriveHeadwordDisposition(verdicts).disposition;
    const counts = new Map<string, number>();
    for (const { record } of paired) {
      const finding = record.finding!;
      const key = finding.exam_level;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const findings = [...counts.keys()];
    return { group, paired, disposition, counts, findings };
  });

  const dispositionTotals = {
    advance: rows.filter((row) => row.disposition === "advance").length,
    exclude: rows.filter((row) => row.disposition === "exclude").length,
    quarantine: rows.filter((row) => row.disposition === "quarantine").length,
  };
  const setLabel = set.name.replaceAll("-", " ");
  const setRole = set.role === "audit" ? "frozen audit" : "exploration draw";
  const promptNumber = usefulnessGate.versions.prompt.split("/").at(-1);
  const reportName = `usefulness-prompt-${promptNumber}-${CASE_SET}.html`;

  const levelFilters = examLevelValues
    .map(
      (value) => `
        <label class="finding-filter finding-${value}">
          <input type="checkbox" value="${value}">
          <span>${LEVEL_LABEL[value]}</span>
          <b>${levelTotals[value]}</b>
        </label>`,
    )
    .join("");

  const rowHtml = rows
    .map(({ group, paired, disposition, counts, findings }) => {
      const zipf = group.meanings[0]?.candidate.zipf;
      const choice = [...counts.entries()]
        .map(([level, count]) => `${LEVEL_LABEL[level as ExamLevel]}${count > 1 ? ` x${count}` : ""}`)
        .join(", ");
      const searchable = [
        group.display,
        ...paired.flatMap(({ subject, record }) => [
          subject.meaning.definition,
          ...subject.meaning.examples,
          record.finding!.rationale,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      const meanings = paired
        .map(({ subject, record }, index) => {
          const finding = record.finding!;
          const cited = new Set(finding.evidence_ids);
          const evidence = evidenceItems(subject)
            .map(
              (item) => `
                <li class="${cited.has(item.id) ? "cited" : ""}">
                  <span>${escapeHtml(item.id)}</span>
                  <b>${escapeHtml(item.kind.replaceAll("_", " "))}</b>
                  ${escapeHtml(item.text)}
                </li>`,
            )
            .join("");
          return `
            <article class="meaning-card">
              <header>
                <div>
                  <span class="meaning-number">Meaning ${index + 1}</span>
                  <code>${escapeHtml(subject.meaning.sense_id)}</code>
                </div>
                 <span class="finding-badge finding-${finding.exam_level}">${LEVEL_LABEL[finding.exam_level]}</span>
              </header>
              <p class="definition">${escapeHtml(subject.meaning.definition)}</p>
              <p class="rationale"><b>Judge's reasoning</b>${escapeHtml(finding.rationale)}</p>
              <details class="evidence-drawer">
                <summary>Evidence and citations</summary>
                <ul>${evidence}</ul>
              </details>
            </article>`;
        })
        .join("");

      return `
        <details class="word-row" data-word="${escapeHtml(group.display.toLowerCase())}"
          data-search="${escapeHtml(searchable)}" data-result="${disposition}"
          data-level="${[...new Set(paired.map(({ record }) => record.finding!.exam_level))].join(",")}"
          data-disagreement="${findings.length > 1}"
          data-zipf="${zipf ?? -1}">
          <summary>
            <span class="word">${escapeHtml(group.display)}</span>
            <span class="zipf">${zipf?.toFixed(3) ?? "n/a"}</span>
            <span class="result result-${disposition}">${disposition === "advance" ? "Keep" : disposition === "exclude" ? "Reject" : "Quarantine"}</span>
            <span class="choices">${escapeHtml(choice)}</span>
            <span class="chevron">+</span>
          </summary>
          <div class="meaning-list">${meanings}</div>
        </details>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WordWell exam-level review - ${escapeHtml(CASE_SET)}</title>
  <style>
    :root { color-scheme: light; --ink:#17201d; --muted:#65716c; --paper:#f4f1e8; --panel:#fffdf7; --line:#d8d3c6; --green:#246b4b; --red:#9b3a2c; --amber:#a56a13; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--paper); color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif; }
    .shell { width:min(1220px,calc(100% - 32px)); margin:0 auto; padding:48px 0 80px; }
    .eyebrow { margin:0 0 10px; color:var(--green); font-size:12px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
    h1 { max-width:850px; margin:0; font-family:Georgia,serif; font-size:clamp(36px,6vw,70px); font-weight:500; line-height:.95; letter-spacing:-.04em; }
    .intro { max-width:760px; margin:24px 0 32px; color:#46514d; font-size:17px; line-height:1.6; }
    .summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:28px; }
    .metric { padding:18px 20px; background:var(--panel); border:1px solid var(--line); border-radius:14px; }
    .metric b { display:block; font-family:Georgia,serif; font-size:34px; font-weight:500; }
    .metric span { color:var(--muted); font-size:13px; }
    .controls { position:sticky; top:0; z-index:5; margin:0 -12px 18px; padding:14px 12px; background:color-mix(in srgb,var(--paper) 94%,transparent); backdrop-filter:blur(12px); border-bottom:1px solid var(--line); }
    .control-row { display:grid; grid-template-columns:minmax(220px,1fr) 180px 190px auto; gap:10px; }
    input[type="search"],select { width:100%; min-height:42px; padding:0 12px; color:var(--ink); background:var(--panel); border:1px solid var(--line); border-radius:9px; font:inherit; }
    .toggle { display:flex; align-items:center; gap:8px; padding:0 10px; white-space:nowrap; }
    .finding-filters { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
    .finding-filter { display:flex; align-items:center; gap:6px; padding:7px 9px; background:var(--panel); border:1px solid var(--line); border-radius:999px; font-size:12px; cursor:pointer; }
    .finding-filter:has(input:checked) { outline:2px solid currentColor; }
    .finding-filter input { position:absolute; opacity:0; }
    .finding-filter b { color:var(--muted); font-size:11px; }
    .table-head,.word-row>summary { display:grid; grid-template-columns:1.1fr 90px 105px 2.2fr 24px; gap:16px; align-items:center; }
    .table-head { padding:0 16px 9px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .word-row { margin-bottom:8px; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    .word-row[hidden] { display:none; }
    .word-row>summary { min-height:62px; padding:11px 16px; cursor:pointer; list-style:none; }
    .word-row>summary::-webkit-details-marker { display:none; }
    .word { font-family:Georgia,serif; font-size:22px; }
    .zipf { color:var(--muted); font-variant-numeric:tabular-nums; }
    .result { width:max-content; padding:5px 8px; border-radius:6px; font-size:11px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
    .result-advance { color:var(--green); background:#e0f0e7; }
    .result-exclude { color:var(--red); background:#f6e3de; }
    .result-quarantine { color:var(--amber); background:#f6ead1; }
    .choices { color:#4c5753; font-size:13px; line-height:1.4; }
    .chevron { color:var(--muted); font-size:22px; transition:transform .15s; }
    .word-row[open] .chevron { transform:rotate(45deg); }
    .meaning-list { display:grid; gap:10px; padding:0 16px 16px; border-top:1px solid var(--line); }
    .meaning-card { margin-top:14px; padding:18px; background:#f8f5ed; border-radius:10px; }
    .meaning-card header { display:flex; justify-content:space-between; gap:16px; align-items:start; }
    .meaning-number { display:block; margin-bottom:5px; color:var(--muted); font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    code { color:#53605b; font-size:11px; overflow-wrap:anywhere; }
    .finding-badge { flex:none; padding:6px 9px; border:1px solid currentColor; border-radius:999px; font-size:11px; font-weight:800; }
    .finding-ordinary,.finding-middle_school { color:#86582a; }
    .finding-high_school,.finding-college,.finding-postgraduate { color:#246b4b; }
    .finding-specialist_subject { color:#8b3c48; }
    .finding-insufficient_evidence { color:#6e706c; }
    .definition { margin:18px 0 10px; font-family:Georgia,serif; font-size:20px; line-height:1.35; }
    .rationale { margin:0; color:#394541; line-height:1.55; }
    .rationale b { display:block; margin-bottom:3px; font-size:11px; letter-spacing:.07em; text-transform:uppercase; }
    .evidence-drawer { margin-top:14px; }
    .evidence-drawer summary { color:var(--muted); font-size:12px; font-weight:700; cursor:pointer; }
    .evidence-drawer ul { display:grid; gap:5px; margin:10px 0 0; padding:0; list-style:none; }
    .evidence-drawer li { padding:7px 9px; color:#5b6561; background:#efebe1; border-left:3px solid transparent; border-radius:4px; font-size:12px; line-height:1.4; }
    .evidence-drawer li.cited { color:var(--ink); border-left-color:var(--green); }
    .evidence-drawer li span { display:inline-block; min-width:25px; font-family:monospace; }
    .evidence-drawer li b { margin-right:7px; text-transform:capitalize; }
    .empty { display:none; padding:40px; color:var(--muted); text-align:center; }
    @media (max-width:800px) {
      .shell { width:min(100% - 20px,1220px); padding-top:28px; }
      .summary-grid { grid-template-columns:repeat(2,1fr); }
      .control-row { grid-template-columns:1fr 1fr; }
      .table-head { display:none; }
      .word-row>summary { grid-template-columns:1fr auto auto; gap:8px 12px; }
      .word { grid-column:1; }
      .zipf { grid-column:2; }
      .result { grid-column:3; }
      .choices { grid-column:1 / 4; }
      .chevron { display:none; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <p class="eyebrow">Audience usefulness / ${escapeHtml(usefulnessGate.versions.prompt)}</p>
    <h1>Where did the judge place each word?</h1>
    <p class="intro">${escapeHtml(setLabel)}, a ${setRole}, classified once per source meaning. High-school, college, or postgraduate vocabulary keeps a headword; ordinary, middle-school, and specialist vocabulary does not. Expand any word to inspect the definitions and the judge's reasoning.</p>
    <section class="summary-grid">
      <div class="metric"><b>${rows.length}</b><span>headwords</span></div>
      <div class="metric"><b>${dispositionTotals.advance}</b><span>kept</span></div>
      <div class="metric"><b>${dispositionTotals.exclude}</b><span>rejected</span></div>
      <div class="metric"><b>${rows.filter((row) => row.findings.length > 1).length}</b><span>mixed-level headwords</span></div>
    </section>
    <section class="controls">
      <div class="control-row">
        <input id="search" type="search" placeholder="Search words, definitions, or reasoning">
        <select id="result"><option value="">All results</option><option value="advance">Kept</option><option value="exclude">Rejected</option><option value="quarantine">Quarantined</option></select>
        <select id="sort"><option value="word">Sort: word</option><option value="zipf-desc">Zipf: high to low</option><option value="zipf-asc">Zipf: low to high</option></select>
        <label class="toggle"><input id="disagreement" type="checkbox"> Mixed levels only</label>
      </div>
      <div class="finding-filters">${levelFilters}</div>
    </section>
    <div class="table-head"><span>Word</span><span>Zipf</span><span>Result</span><span>Recorded levels</span><span></span></div>
    <section id="rows">${rowHtml}</section>
    <p id="empty" class="empty">No words match these filters.</p>
  </main>
  <script>
    const container = document.querySelector('#rows');
    const rows = [...container.querySelectorAll('.word-row')];
    const search = document.querySelector('#search');
    const result = document.querySelector('#result');
    const sort = document.querySelector('#sort');
    const disagreement = document.querySelector('#disagreement');
    const findingInputs = [...document.querySelectorAll('.finding-filter input')];
    const empty = document.querySelector('#empty');
    function refresh() {
      const query = search.value.trim().toLowerCase();
      const levels = findingInputs.filter(input => input.checked).map(input => input.value);
      let visible = 0;
      for (const row of rows) {
        const show = (!query || row.dataset.search.includes(query))
          && (!result.value || row.dataset.result === result.value)
          && (!disagreement.checked || row.dataset.disagreement === 'true')
          && (!levels.length || levels.some(value => row.dataset.level.split(',').includes(value)));
        row.hidden = !show;
        if (show) visible += 1;
      }
      const sorted = [...rows].sort((a, b) => {
        if (sort.value === 'zipf-desc') return Number(b.dataset.zipf) - Number(a.dataset.zipf);
        if (sort.value === 'zipf-asc') return Number(a.dataset.zipf) - Number(b.dataset.zipf);
        return a.dataset.word.localeCompare(b.dataset.word);
      });
      sorted.forEach(row => container.append(row));
      empty.style.display = visible ? 'none' : 'block';
    }
    [search, result, sort, disagreement, ...findingInputs].forEach(control => control.addEventListener('input', refresh));
    refresh();
  </script>
</body>
</html>`;

  mkdirSync(REPORTS_DIR, { recursive: true });
  const outputPath = join(REPORTS_DIR, reportName);
  writeFileSync(outputPath, html);
  console.log(`${outputPath}: ${rows.length} headwords, ${pairedMeaningCount(rows)} meanings`);
}

function pairedMeaningCount(rows: { paired: unknown[] }[]): number {
  return rows.reduce((total, row) => total + row.paired.length, 0);
}

main();
