import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadUnlabelledSet,
  loadUsefulnessDataset,
} from "../evals/usefulness-datasets.ts";
import { RUNS_DIR } from "./config.ts";
import type { Disposition } from "./disposition.ts";
import type { AdjudicationRecord } from "./store.ts";
import { evidenceItems } from "./usefulness/meaning.ts";
import type { HeadwordGroup } from "./usefulness/run.ts";

const REPORTS_DIR = "reports";
const PROMPT_NUMBER = process.env.PROMPT_NUMBER ?? "10";
const REPORT_DATASETS = new Set(
  (process.env.REPORT_DATASETS ?? "golden,audit,exploration").split(","),
);
const reportScope = REPORT_DATASETS.size === 3 ? "all-sets" : [...REPORT_DATASETS].join("-");
const OUTPUT_NAME = `usefulness-prompt-${PROMPT_NUMBER}-${reportScope}.html`;
const V10 = {
  prompt: `usefulness-prompt/${PROMPT_NUMBER}`,
  rubric: "usefulness-rubric/10",
  contract: "usefulness-finding/4",
  policy: "usefulness-policy/3",
} as const;
const RUN_CONFIG = {
  extraction: "usefulness-evidence/1",
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

interface TeachingValueFinding {
  sense_id: string;
  familiarity: "common" | "less_common" | "uncommon" | "unknown";
  scope: "general" | "specialist_subject" | "sensitive_body_or_medical" | "unknown";
  learning_value: "high" | "low" | "unknown";
  rationale: string;
  evidence_ids: string[];
}

interface ReportCase {
  dataset: "golden" | "audit" | "exploration";
  group: HeadwordGroup;
  expected?: {
    disposition: Disposition;
    bucket: string;
    why: string;
  };
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadV10Records(): Map<string, AdjudicationRecord<TeachingValueFinding>> {
  const records = new Map<string, AdjudicationRecord<TeachingValueFinding>>();
  for (const name of readdirSync(RUNS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(
      readFileSync(join(RUNS_DIR, name), "utf8"),
    ) as AdjudicationRecord<TeachingValueFinding>;
    if (
      record.gate !== "audience-usefulness" ||
      record.fingerprint.prompt_version !== V10.prompt ||
      record.fingerprint.rubric_version !== V10.rubric ||
      record.fingerprint.contract_version !== V10.contract ||
      record.fingerprint.policy_version !== V10.policy ||
      record.fingerprint.extraction_version !== RUN_CONFIG.extraction ||
      record.fingerprint.deterministic_rules_sha256 !== RUN_CONFIG.deterministicRules ||
      record.fingerprint.sources.oewn.release !== RUN_CONFIG.oewnRelease ||
      record.fingerprint.sources.oewn.retrieved_via !== RUN_CONFIG.oewnRetrievedVia ||
      record.fingerprint.sources.wordfreq.version !== RUN_CONFIG.wordfreqVersion ||
      record.fingerprint.sources.wordfreq.wordlist !== RUN_CONFIG.wordfreqWordlist ||
      record.fingerprint.sources.candidate_pool.path !== RUN_CONFIG.candidatePoolPath ||
      record.fingerprint.sources.candidate_pool.sha256 !== RUN_CONFIG.candidatePool ||
      record.fingerprint.provider !== RUN_CONFIG.provider ||
      record.fingerprint.model !== RUN_CONFIG.model ||
      record.fingerprint.upstream_provider !== RUN_CONFIG.upstream ||
      record.fingerprint.temperature !== RUN_CONFIG.temperature ||
      record.fingerprint.seed !== RUN_CONFIG.seed
    ) {
      continue;
    }
    const existing = records.get(record.claim_id);
    if (!existing || record.recorded_at > existing.recorded_at) {
      records.set(record.claim_id, record);
    }
  }
  return records;
}

function dispositionOf(records: AdjudicationRecord<TeachingValueFinding>[]): Disposition {
  const dispositions = records.map((record) => {
    if (!record.decision) throw new Error(`no v10 decision for ${record.claim_id}`);
    return record.decision.disposition;
  });
  if (dispositions.includes("advance")) return "advance";
  if (dispositions.includes("quarantine")) return "quarantine";
  return "exclude";
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
  const cases: ReportCase[] = [
    ...golden.cases.map(({ group, expected }) => ({
      dataset: "golden" as const,
      group,
      expected: {
        disposition: expected.disposition,
        bucket: expected.bucket,
        why: expected.why,
      },
    })),
    ...audit.groups.map((group) => ({ dataset: "audit" as const, group })),
    ...exploration.groups.map((group) => ({ dataset: "exploration" as const, group })),
  ].filter((entry) => REPORT_DATASETS.has(entry.dataset));
  const recordIndex = loadV10Records();

  const rows = cases.map((entry) => {
    const paired = entry.group.meanings.map((subject) => {
      const record = recordIndex.get(subject.subject_id);
      if (!record?.finding) throw new Error(`no ${V10.prompt} finding for ${subject.subject_id}`);
      if (record.fingerprint.input_digest !== subject.input_digest) {
        throw new Error(`input digest mismatch for ${subject.subject_id}`);
      }
      return { subject, record };
    });
    const disposition = dispositionOf(paired.map(({ record }) => record));
    return { ...entry, paired, disposition };
  });

  const summaries = (["golden", "audit", "exploration"] as const)
    .filter((dataset) => REPORT_DATASETS.has(dataset))
    .map((dataset) => {
    const selected = rows.filter((row) => row.dataset === dataset);
    return {
      dataset,
      total: selected.length,
      kept: selected.filter((row) => row.disposition === "advance").length,
      rejected: selected.filter((row) => row.disposition === "exclude").length,
      quarantined: selected.filter((row) => row.disposition === "quarantine").length,
      correct: selected.filter(
        (row) => row.expected && row.expected.disposition === row.disposition,
      ).length,
    };
    });

  const rowHtml = rows
    .map(({ dataset, group, expected, paired, disposition }) => {
      const zipf = group.meanings[0]?.candidate.zipf;
      const findings = paired.map(({ record }) => record.finding!);
      const propertyText = findings
        .map(
          (finding) =>
            `${finding.familiarity.replaceAll("_", " ")} / ${finding.scope.replaceAll("_", " ")} / ${finding.learning_value} value`,
        )
        .join("; ");
      const agrees = expected ? expected.disposition === disposition : undefined;
      const searchable = [
        group.display,
        expected?.why ?? "",
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
            .filter((item) => !["11", "12"].includes(PROMPT_NUMBER) || item.kind !== "synonyms")
            .filter((item) => PROMPT_NUMBER !== "12" || item.kind !== "definition")
            .map(
              (item) => `<li class="${cited.has(item.id) ? "cited" : ""}"><span>${escapeHtml(item.id)}</span><b>${escapeHtml(item.kind.replaceAll("_", " "))}</b>${escapeHtml(item.text)}</li>`,
            )
            .join("");
          return `<article class="meaning-card">
            <header><div><span class="meaning-number">Meaning ${index + 1}</span><code>${escapeHtml(subject.meaning.sense_id)}</code></div>
              <div class="badges"><span class="badge familiarity-${finding.familiarity}">${escapeHtml(finding.familiarity.replaceAll("_", " "))}</span><span class="badge scope-${finding.scope}">${escapeHtml(finding.scope.replaceAll("_", " "))}</span><span class="badge value-${finding.learning_value}">${escapeHtml(finding.learning_value)} value</span></div></header>
            <p class="definition">${escapeHtml(subject.meaning.definition)}</p>
            <p class="rationale"><b>Judge's reasoning</b>${escapeHtml(finding.rationale)}</p>
            <details class="evidence"><summary>Evidence and citations</summary><ul>${evidence}</ul></details>
          </article>`;
        })
        .join("");
      const humanLabel = expected
        ? `<span class="human ${agrees ? "match" : "mismatch"}">Human: ${escapeHtml(expected.bucket)} ${agrees ? "(match)" : "(mismatch)"}</span>`
        : `<span class="human unlabelled">Unlabelled</span>`;
      const expectedHtml = expected
        ? `<p class="owner"><b>Owner's label</b>${escapeHtml(expected.bucket)}: ${escapeHtml(expected.why)}</p>`
        : "";
      const values = findings.flatMap((finding) => [
        finding.familiarity,
        finding.scope,
        finding.learning_value,
      ]);
      return `<details class="word-row" data-dataset="${dataset}" data-result="${disposition}" data-search="${escapeHtml(searchable)}" data-values="${values.join(",")}" data-word="${escapeHtml(group.display.toLowerCase())}" data-zipf="${zipf ?? -1}" data-mismatch="${agrees === false}">
        <summary><span><span class="dataset">${dataset}</span><span class="word">${escapeHtml(group.display)}</span></span><span class="zipf">${zipf?.toFixed(3) ?? "n/a"}</span><span class="result result-${disposition}">${resultLabel(disposition)}</span><span class="properties">${escapeHtml(propertyText)}</span>${humanLabel}<span class="chevron">+</span></summary>
        <div class="details">${expectedHtml}${meanings}</div>
      </details>`;
    })
    .join("");

  const summaryHtml = summaries
    .map(
      (summary) => `<article><h2>${summary.dataset}</h2><b>${summary.kept}</b> kept · <b>${summary.rejected}</b> rejected${summary.quarantined ? ` · <b>${summary.quarantined}</b> quarantined` : ""}${summary.dataset === "golden" ? ` · <b>${summary.correct}/${summary.total}</b> match human labels` : ""}</article>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>WordWell prompt v${escapeHtml(PROMPT_NUMBER)} review</title><style>
:root{color-scheme:light;--ink:#17201d;--muted:#65716c;--paper:#f4f1e8;--panel:#fffdf7;--line:#d8d3c6;--green:#246b4b;--red:#9b3a2c;--amber:#a56a13;--blue:#306d8a}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}.shell{width:min(1320px,calc(100% - 32px));margin:auto;padding:44px 0 80px}.eyebrow,.dataset,.meaning-number{font-size:11px;font-weight:800;letter-spacing:.11em;text-transform:uppercase}.eyebrow{color:var(--green)}h1{max-width:900px;margin:8px 0 20px;font:500 clamp(38px,6vw,68px)/.98 Georgia,serif;letter-spacing:-.04em}.intro{max-width:850px;color:#46514d;font-size:17px;line-height:1.6}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:28px 0}.summary article{padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.summary h2{margin:0 0 9px;color:var(--muted);font-size:12px;text-transform:capitalize}.controls{position:sticky;top:0;z-index:5;display:grid;grid-template-columns:minmax(220px,1fr) repeat(3,170px);gap:10px;margin:0 -10px 18px;padding:13px 10px;background:color-mix(in srgb,var(--paper) 94%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}input,select{width:100%;min-height:42px;padding:0 11px;background:var(--panel);border:1px solid var(--line);border-radius:8px;font:inherit}.word-row{margin-bottom:8px;background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}.word-row[hidden]{display:none}.word-row>summary{display:grid;grid-template-columns:1fr 75px 90px 2fr 145px 24px;gap:13px;align-items:center;min-height:68px;padding:11px 15px;cursor:pointer;list-style:none}.word-row>summary::-webkit-details-marker{display:none}.dataset{display:block;color:var(--muted);margin-bottom:3px}.word{font:22px Georgia,serif}.zipf,.properties{color:var(--muted);font-size:13px}.result{width:max-content;padding:5px 8px;border-radius:6px;font-size:11px;font-weight:800;text-transform:uppercase}.result-advance{color:var(--green);background:#e0f0e7}.result-exclude{color:var(--red);background:#f6e3de}.result-quarantine{color:var(--amber);background:#f6ead1}.human{font-size:12px}.human.match{color:var(--green)}.human.mismatch{color:var(--red);font-weight:800}.human.unlabelled{color:var(--muted)}.chevron{font-size:22px;color:var(--muted);transition:.15s}.word-row[open] .chevron{transform:rotate(45deg)}.details{display:grid;gap:10px;padding:14px 16px 16px;border-top:1px solid var(--line)}.owner,.meaning-card{margin:0;padding:17px;background:#f8f5ed;border-radius:10px}.owner b,.rationale b{display:block;margin-bottom:4px;font-size:11px;letter-spacing:.07em;text-transform:uppercase}.meaning-card header{display:flex;justify-content:space-between;gap:14px}.meaning-number{display:block;color:var(--muted);margin-bottom:4px}code{font-size:11px;color:#53605b;overflow-wrap:anywhere}.badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px}.badge{padding:5px 8px;border:1px solid currentColor;border-radius:999px;font-size:11px;font-weight:800}.familiarity-common,.value-low{color:#86582a}.familiarity-less_common,.scope-general{color:var(--blue)}.familiarity-uncommon,.value-high{color:var(--green)}.scope-specialist_subject,.scope-sensitive_body_or_medical{color:#8b3c48}.familiarity-unknown,.scope-unknown,.value-unknown{color:#6e706c}.definition{margin:18px 0 10px;font:20px/1.35 Georgia,serif}.rationale{color:#394541;line-height:1.55}.evidence{margin-top:13px}.evidence summary{color:var(--muted);font-size:12px;font-weight:700;cursor:pointer}.evidence ul{display:grid;gap:5px;margin:10px 0 0;padding:0;list-style:none}.evidence li{padding:7px 9px;color:#5b6561;background:#efebe1;border-left:3px solid transparent;border-radius:4px;font-size:12px;line-height:1.4}.evidence li.cited{color:var(--ink);border-left-color:var(--green)}.evidence li span{display:inline-block;min-width:27px;font-family:monospace}.evidence li b{margin-right:7px;text-transform:capitalize}.empty{display:none;padding:40px;text-align:center;color:var(--muted)}
@media(max-width:850px){.shell{width:calc(100% - 20px);padding-top:26px}.summary{grid-template-columns:1fr}.controls{grid-template-columns:1fr 1fr}.word-row>summary{grid-template-columns:1fr auto auto;gap:8px}.properties,.human{grid-column:1/4}.chevron{display:none}.meaning-card header{display:block}.badges{justify-content:flex-start;margin-top:10px}}
</style></head><body><main class="shell"><p class="eyebrow">Audience usefulness / historical prompt v${escapeHtml(PROMPT_NUMBER)}</p><h1>What did the teaching-value judge decide?</h1><p class="intro">Gemini 2.5 Flash via Google AI Studio, temperature 0. This prompt did not assign exam levels. It recorded familiarity, scope, and learning value for each source meaning.${PROMPT_NUMBER === "11" ? " V11 used the exact v10 rubric but omitted supplied synonyms from the evidence." : ""}${PROMPT_NUMBER === "12" ? " V12 used the exact v10 rubric but omitted supplied definitions and synonyms from the evidence." : ""} Policy kept a headword when at least one meaning was general, less-common or uncommon, and high-value. Golden labels are shown for comparison; audit and exploration remain deliberately unlabelled.</p><section class="summary">${summaryHtml}</section>
<section class="controls"><input id="search" type="search" placeholder="Search words, definitions, or reasoning"><select id="dataset"><option value="">All datasets</option><option value="golden">Golden</option><option value="audit">Audit</option><option value="exploration">Exploration</option></select><select id="result"><option value="">All results</option><option value="advance">Kept</option><option value="exclude">Rejected</option><option value="quarantine">Quarantined</option></select><select id="property"><option value="">All properties</option><option value="common">Common</option><option value="less_common">Less common</option><option value="uncommon">Uncommon</option><option value="general">General</option><option value="specialist_subject">Specialist subject</option><option value="sensitive_body_or_medical">Sensitive/body/medical</option><option value="high">High value</option><option value="low">Low value</option><option value="mismatch">Golden mismatches</option></select></section>
<section id="rows">${rowHtml}</section><p id="empty" class="empty">No words match these filters.</p></main><script>
const rows=[...document.querySelectorAll('.word-row')],search=document.querySelector('#search'),dataset=document.querySelector('#dataset'),result=document.querySelector('#result'),property=document.querySelector('#property'),empty=document.querySelector('#empty');function refresh(){const q=search.value.trim().toLowerCase();let visible=0;for(const row of rows){const propertyMatch=!property.value||(property.value==='mismatch'?row.dataset.mismatch==='true':row.dataset.values.split(',').includes(property.value));const show=(!q||row.dataset.search.includes(q))&&(!dataset.value||row.dataset.dataset===dataset.value)&&(!result.value||row.dataset.result===result.value)&&propertyMatch;row.hidden=!show;if(show)visible++}empty.style.display=visible?'none':'block'}[search,dataset,result,property].forEach(control=>control.addEventListener('input',refresh));refresh();
</script></body></html>`;

  mkdirSync(REPORTS_DIR, { recursive: true });
  const outputPath = join(REPORTS_DIR, OUTPUT_NAME);
  writeFileSync(outputPath, html);
  const meanings = rows.reduce((total, row) => total + row.paired.length, 0);
  console.log(`${outputPath}: ${rows.length} rows, ${meanings} meanings`);
}

main();
