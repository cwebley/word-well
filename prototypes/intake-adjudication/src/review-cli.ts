import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Claim } from "./morphology/claim.ts";
import { RUBRIC, RUBRIC_VERSION } from "./morphology/prompt.ts";

interface PartitionMember {
  claim_id: string;
  input_digest: string;
  partition: string;
  primary_slice: string;
}

interface PartitionFile {
  evidence_manifest_sha256: string;
  members: PartitionMember[];
  partition_version: string;
}

interface ReviewCase {
  claim: Omit<Claim, "policy_context">;
  endorsements: number;
  member: PartitionMember;
  provisional_label: Record<string, unknown> | null;
}

interface ReviewPayload {
  evidence_digest: string;
  partition_version: string;
  rubric: string;
  rubric_version: string;
  cases: ReviewCase[];
}

const prototypeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEvidence = resolve(prototypeRoot, "evidence/calibration-silver.claims.jsonl");
const defaultPartitions = resolve(prototypeRoot, "cases/calibration-v1.partitions.json");
const defaultProvisionalPaths = [
  resolve(prototypeRoot, "labels/calibration-silver.labels.jsonl"),
  resolve(prototypeRoot, "labels/calibration-silver.provisional.jsonl"),
];
const defaultOutput = resolve(prototypeRoot, "review/calibration-v1.html");

function readJsonl(path: string): Record<string, unknown>[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSON`, { cause: error });
      }
    });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${field} must be a string`);
  return value;
}

export function escapeEmbeddedJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function assembleReviewPayload(options: {
  evidencePath: string;
  partitionsPath: string;
  provisionalPath?: string;
}): ReviewPayload {
  const partitions = JSON.parse(readFileSync(options.partitionsPath, "utf8")) as PartitionFile;
  if (!Array.isArray(partitions.members) || partitions.members.length !== 12) {
    throw new Error(`Frozen partition must contain exactly 12 members; found ${partitions.members?.length}`);
  }
  requireString(partitions.partition_version, "partition_version");
  requireString(partitions.evidence_manifest_sha256, "evidence_manifest_sha256");

  const claims = new Map<string, Claim>();
  for (const raw of readJsonl(options.evidencePath)) {
    const claim = raw as unknown as Claim;
    const claimId = requireString(claim.claim_id, "claim.claim_id");
    if (claims.has(claimId)) throw new Error(`Duplicate evidence claim: ${claimId}`);
    claims.set(claimId, claim);
  }

  const labels = new Map<string, Record<string, unknown>>();
  if (options.provisionalPath) {
    for (const label of readJsonl(options.provisionalPath)) {
      const claimId = requireString(label.claim_id, "provisional_label.claim_id");
      if (label.label_status !== "provisional-unvalidated") {
        throw new Error(`Provisional label ${claimId} must have label_status provisional-unvalidated`);
      }
      if (labels.has(claimId)) throw new Error(`Duplicate provisional label: ${claimId}`);
      labels.set(claimId, label);
    }
  }

  const memberIds = new Set<string>();
  const cases = partitions.members.map((member) => {
    if (memberIds.has(member.claim_id)) throw new Error(`Duplicate partition member: ${member.claim_id}`);
    memberIds.add(member.claim_id);
    const claim = claims.get(member.claim_id);
    if (!claim) throw new Error(`Partition member is absent from evidence: ${member.claim_id}`);
    if (claim.input_digest !== member.input_digest) {
      throw new Error(`Input digest mismatch for ${member.claim_id}`);
    }
    const meaningIds = claim.candidate.source_meanings.map((meaning) => meaning.sense_id);
    if (new Set(meaningIds).size !== meaningIds.length) {
      throw new Error(`Candidate source meaning appears more than once: ${member.claim_id}`);
    }
    const { policy_context: policyContext, ...judgeEvidence } = claim;
    return {
      claim: judgeEvidence,
      endorsements: policyContext.endorsements,
      member,
      provisional_label: labels.get(member.claim_id) ?? null,
    };
  });

  return {
    evidence_digest: partitions.evidence_manifest_sha256,
    partition_version: partitions.partition_version,
    rubric: RUBRIC,
    rubric_version: RUBRIC_VERSION,
    cases,
  };
}

export function buildReviewHtml(payload: ReviewPayload): string {
  const embedded = escapeEmbeddedJson(payload);
  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Morphology calibration review</title>
<style>
:root{color-scheme:light;--ink:#17201d;--muted:#65706b;--paper:#f5f2e9;--panel:#fffdf7;--line:#d8d2c3;--accent:#145c4b;--warn:#9b3b27;--mono:ui-monospace,SFMono-Regular,Consolas,monospace}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 Georgia,serif}button,input,select,textarea{font:inherit}button{cursor:pointer}.top{position:sticky;top:0;z-index:2;background:#173a32;color:#fff;padding:12px 4vw;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.top h1{font-size:18px;margin:0 auto 0 0}.top button,.top select,.top input{border:1px solid #ffffff55;border-radius:4px;background:#fff;color:var(--ink);padding:7px 9px}.top input{min-width:190px}.counter{font-family:var(--mono);font-size:13px}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(340px,460px);gap:24px;max-width:1500px;margin:auto;padding:28px 4vw 80px}.card{background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:20px;margin-bottom:18px;box-shadow:0 2px 9px #312b2010}h2,h3{line-height:1.15}h2{font-size:30px;margin:0 0 4px}h3{font-size:17px;margin:0 0 12px;text-transform:uppercase;letter-spacing:.06em;color:var(--accent)}.meta,.subtle{color:var(--muted)}.mono,code,pre{font-family:var(--mono);font-size:13px}pre{white-space:pre-wrap;word-break:break-word;margin:0}.meaning{border-left:3px solid #8da99f;padding:10px 12px;margin:10px 0;background:#f8f7f1}.meaning strong{font-family:var(--mono);font-size:12px}.component{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}.component:first-of-type{border-top:0;margin-top:0}.missing{color:var(--warn)}.review{position:sticky;top:86px}.field{margin:14px 0}.field label{display:block;font-weight:bold;margin-bottom:5px}.field select,.field textarea{width:100%;padding:8px;border:1px solid var(--line);border-radius:4px;background:#fff}.field textarea{min-height:76px}.sense-field{border-top:1px solid var(--line);padding-top:12px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}.actions button{border:0;border-radius:4px;padding:9px 12px;background:var(--accent);color:#fff}.actions button.secondary{background:#56625e}.actions button.uncertain{background:var(--warn)}button:disabled{opacity:.4;cursor:not-allowed}.status{padding:8px 10px;border-radius:4px;background:#ece8dc;font-family:var(--mono);font-size:12px}.policy{border:2px solid #b78c39;background:#fff8df}.provisional{background:#eef4f1}.rubric summary{cursor:pointer;font-weight:bold}.rubric pre{margin-top:14px;max-height:480px;overflow:auto}.empty{text-align:center;padding:80px 20px}.error{color:var(--warn);font-weight:bold}@media(max-width:900px){.layout{grid-template-columns:1fr;padding-top:18px}.review{position:static}.top{position:static}.top h1{width:100%}}
.field>label{display:block;font-weight:bold;margin-bottom:5px}.choices{display:flex;gap:7px;flex-wrap:wrap}.choices label{display:flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:4px;padding:7px 9px;background:#fff;cursor:pointer;font:13px var(--mono)}.choices label:has(input:checked){border-color:var(--accent);background:#e6f0ec;color:var(--accent)}.choices input{margin:0}.reveal{border:0;border-radius:4px;padding:9px 12px;background:var(--accent);color:#fff}.provisional-answer{margin-top:12px}
</style>
</head>
<body>
<header class="top"><h1>Morphology calibration</h1><span id="counter" class="counter"></span><input id="search" type="search" placeholder="Search claim ID"><select id="partition-filter"><option value="all">all partitions</option><option value="development">development</option><option value="regression">regression</option><option value="hidden_holdout">hidden holdout</option></select><select id="status-filter"><option value="all">all states</option><option value="unreviewed">unreviewed</option><option value="complete">complete</option><option value="uncertain">uncertain</option></select><button id="previous">Previous</button><button id="next">Next</button><button id="export-progress">Export progress</button><button id="import-progress">Import progress</button><button id="export-labels">Export validated JSONL</button><input id="import-file" type="file" accept="application/json" hidden></header>
<main id="app" class="layout"></main>
<script id="review-data" type="application/json">${embedded}</script>
<script>
"use strict";
const payload=JSON.parse(document.getElementById("review-data").textContent);
const app=document.getElementById("app");
const analysisValues=["supported","unsupported","insufficient_evidence"];
const predictabilityValues=["predictable","not_predictable","insufficient_evidence"];
let visible=[];let index=0;
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node}
function add(parent,child){parent.appendChild(child);return child}
function storageKey(item){return ["wordwell-morphology-review",payload.partition_version,payload.evidence_digest,payload.rubric_version,item.claim.input_digest].join(":")}
function blank(item){return {claim_id:item.claim.claim_id,input_digest:item.claim.input_digest,analysis_support:"",meanings:Object.fromEntries(item.claim.candidate.source_meanings.map(function(m){return [m.sense_id,""]})),note:"",review_decision:"draft",validated_at:null}}
function load(item){try{const value=JSON.parse(localStorage.getItem(storageKey(item)));return value&&value.claim_id===item.claim.claim_id?Object.assign(blank(item),value):blank(item)}catch{return blank(item)}}
function save(item,state){localStorage.setItem(storageKey(item),JSON.stringify(state));updateCounter()}
function complete(item,state){const ids=item.claim.candidate.source_meanings.map(function(m){return m.sense_id});return analysisValues.includes(state.analysis_support)&&ids.length===Object.keys(state.meanings||{}).length&&ids.every(function(id){return predictabilityValues.includes(state.meanings[id])})}
function isValidated(item,state){return complete(item,state)&&(state.review_decision==="accepted"||state.review_decision==="corrected")&&Boolean(state.validated_at)}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==="object"){const out={};Object.keys(value).sort().forEach(function(key){out[key]=canonical(value[key])});return out}return value}
function download(name,text,type){const blob=new Blob([text],{type:type});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(function(){URL.revokeObjectURL(url)},0)}
function optionRadios(values,current,name,displayLabels){const group=el("div","choices");values.forEach(function(value){const label=add(group,el("label"));const input=add(label,el("input"));input.type="radio";input.name=name;input.value=value;input.checked=value===current;add(label,el("span","",displayLabels&&displayLabels[value]||value))});Object.defineProperty(group,"value",{get:function(){const checked=group.querySelector("input:checked");return checked?checked.value:""},set:function(value){group.querySelectorAll("input").forEach(function(input){input.checked=input.value===value})}});return group}
function renderMeaning(parent,meaning){const box=add(parent,el("div","meaning"));add(box,el("strong","",meaning.sense_id+" · "+meaning.pos));add(box,el("div","",meaning.definition));if(meaning.synset_members.length>1)add(box,el("div","subtle","Recorded alongside: "+meaning.synset_members.join(", ")));meaning.examples.forEach(function(example){add(box,el("div","subtle","Example: "+example))});if(meaning.examples_truncated)add(box,el("div","subtle","Further examples omitted by extractor"))}
function provisionalSemantic(item){const label=item.provisional_label;if(!label||!analysisValues.includes(label.analysis_support)||!Array.isArray(label.meanings))return null;const meanings={};for(const finding of label.meanings){const ids=Array.isArray(finding.sense_ids)?finding.sense_ids:[finding.sense_id];if(!predictabilityValues.includes(finding.predictability))return null;for(const id of ids){if(typeof id!=="string"||Object.hasOwn(meanings,id))return null;meanings[id]=finding.predictability}}const candidateIds=item.claim.candidate.source_meanings.map(function(m){return m.sense_id});if(candidateIds.length!==Object.keys(meanings).length||!candidateIds.every(function(id){return Object.hasOwn(meanings,id)}))return null;return {analysis_support:label.analysis_support,meanings:meanings,note:typeof label.note==="string"?label.note:""}}
function dispositions(item,state){const values=Object.values(state.meanings);let morphology;if(state.analysis_support==="insufficient_evidence")morphology="quarantine";else if(state.analysis_support==="unsupported")morphology="advance";else if(values.includes("not_predictable"))morphology="advance";else if(values.length===0||values.includes("insufficient_evidence"))morphology="quarantine";else morphology="exclude";const override=morphology==="exclude"&&item.endorsements>0;return {morphology:morphology,effective:override?"advance":morphology,override:override}}
function statusOf(item){const state=load(item);if(state.review_decision==="uncertain")return "uncertain";if(isValidated(item,state))return "complete";return "unreviewed"}
function updateCounter(){const completed=payload.cases.filter(function(item){return isValidated(item,load(item))}).length;const uncertain=payload.cases.filter(function(item){return load(item).review_decision==="uncertain"}).length;document.getElementById("counter").textContent=completed+" / "+payload.cases.length+" validated · "+uncertain+" uncertain"}
function render(){app.textContent="";if(!visible.length){add(app,el("div","empty","No cases match these filters."));return}if(index>=visible.length)index=visible.length-1;const item=visible[index];const claim=item.claim;let state=load(item);const provisional=provisionalSemantic(item);const evidence=add(app,el("section"));const heading=add(evidence,el("div","card"));add(heading,el("h2","",claim.candidate.display));add(heading,el("div","mono",claim.claim_id));add(heading,el("div","meta",item.member.partition+" · "+claim.claim.rule_kind+" · "+item.member.primary_slice));add(heading,el("div","meta","Parts of speech: "+(claim.candidate.pos.join(", ")||"none recorded")+" · Frequency (Zipf): "+(claim.candidate.zipf===null?"MISSING FROM EVIDENCE":claim.candidate.zipf)));add(heading,el("h3","","Claim"));add(heading,el("pre","",JSON.stringify(claim.claim.decomposition,null,2)));
const provisionalBox=add(evidence,el("section","card provisional"));add(provisionalBox,el("h3","","Provisional label"));if(!provisional)add(provisionalBox,el("div","subtle",item.provisional_label?"Present but invalid for this evidence.":"No provisional label supplied."));else{const reveal=add(provisionalBox,el("button","reveal","Reveal provisional"));const answer=add(provisionalBox,el("div","provisional-answer"));answer.hidden=true;add(answer,el("div","","Analysis: "+provisional.analysis_support));claim.candidate.source_meanings.forEach(function(meaning){add(answer,el("div","mono",meaning.sense_id+": "+provisional.meanings[meaning.sense_id]))});reveal.addEventListener("click",function(){answer.hidden=!answer.hidden;reveal.textContent=answer.hidden?"Reveal provisional":"Hide provisional"})}
const meanings=add(evidence,el("section","card"));add(meanings,el("h3","","Source meanings ("+claim.candidate.source_meanings.length+")"));claim.candidate.source_meanings.forEach(function(meaning){renderMeaning(meanings,meaning)});
const components=add(evidence,el("section","card"));add(components,el("h3","","Component evidence"));if(!claim.claim.components.length)add(components,el("div","subtle","No components supplied."));claim.claim.components.forEach(function(component){const box=add(components,el("div","component"));add(box,el("h4","",component.role+": "+component.display));add(box,el("div","subtle","Frequency (Zipf): "+(component.zipf===null?"MISSING FROM EVIDENCE":component.zipf)));if(!component.source_meanings.length)add(box,el("div","missing","No recorded meanings in evidence."));component.source_meanings.forEach(function(meaning){renderMeaning(box,meaning)})});
const missing=add(evidence,el("section","card"));add(missing,el("h3","","Missing evidence"));if(claim.missing_evidence.length)claim.missing_evidence.forEach(function(marker){add(missing,el("div","missing mono",marker))});else add(missing,el("div","subtle","None recorded by the extractor."));
const rubric=add(evidence,el("details","card rubric"));const summary=add(rubric,el("summary","","Rubric · "+payload.rubric_version));add(rubric,el("pre","",payload.rubric));summary.setAttribute("aria-label","Toggle rubric");
const sidebar=add(app,el("aside","review"));const form=add(sidebar,el("section","card"));add(form,el("h3","","Semantic decision"));const status=add(form,el("div","status",state.review_decision));const analysisField=add(form,el("div","field"));add(analysisField,el("label","","Analysis support"));const analysis=add(analysisField,optionRadios(analysisValues,state.analysis_support,"analysis"));const meaningSelects={};claim.candidate.source_meanings.forEach(function(meaning,meaningIndex){const field=add(form,el("div","field sense-field"));add(field,el("label","",meaning.sense_id));add(field,el("div","subtle",meaning.definition));meaningSelects[meaning.sense_id]=add(field,optionRadios(predictabilityValues,state.meanings[meaning.sense_id],"meaning-"+meaningIndex))});const noteField=add(form,el("div","field"));add(noteField,el("label","","Reviewer note (optional)"));const note=add(noteField,el("textarea"));note.value=state.note||"";const policyBox=add(sidebar,el("section","card policy"));
function readForm(){return Object.assign({},state,{analysis_support:analysis.value,meanings:Object.fromEntries(Object.entries(meaningSelects).map(function(entry){return [entry[0],entry[1].value]})),note:note.value})}
function renderPolicy(){policyBox.textContent="";const current=readForm();if(current.review_decision==="uncertain"||!complete(item,current)){policyBox.hidden=true;return}policyBox.hidden=false;const result=dispositions(item,current);add(policyBox,el("h3","","Policy context (revealed after decision)"));add(policyBox,el("div","","Morphology disposition: "+result.morphology));add(policyBox,el("div","","Editorial endorsements: "+item.endorsements));add(policyBox,el("div","","Effective disposition: "+result.effective));if(result.override)add(policyBox,el("div","","Endorsement override applied."))}
function draftChanged(){state=readForm();state.review_decision="draft";state.validated_at=null;status.textContent="draft";save(item,state);renderPolicy()}
analysis.addEventListener("change",draftChanged);Object.values(meaningSelects).forEach(function(select){select.addEventListener("change",draftChanged)});note.addEventListener("change",draftChanged);
const actions=add(form,el("div","actions"));const accept=add(actions,el("button","","Accept provisional"));accept.disabled=!provisional;accept.addEventListener("click",function(){if(!provisional)return;analysis.value=provisional.analysis_support;Object.keys(meaningSelects).forEach(function(id){meaningSelects[id].value=provisional.meanings[id]});if(!note.value)note.value=provisional.note;state=readForm();state.review_decision="accepted";state.validated_at=new Date().toISOString();save(item,state);render()});const correct=add(actions,el("button","secondary","Save correction"));correct.addEventListener("click",function(){state=readForm();if(!complete(item,state)){alert("Choose analysis support and one predictability value for every source meaning.");return}state.review_decision="corrected";state.validated_at=new Date().toISOString();save(item,state);render()});const uncertain=add(actions,el("button","uncertain","Mark uncertain"));uncertain.addEventListener("click",function(){state=readForm();state.review_decision="uncertain";state.validated_at=null;save(item,state);render()});renderPolicy();document.getElementById("previous").disabled=index===0;document.getElementById("next").disabled=index===visible.length-1}
function applyFilters(){const partition=document.getElementById("partition-filter").value;const status=document.getElementById("status-filter").value;const search=document.getElementById("search").value.toLowerCase();visible=payload.cases.filter(function(item){return (partition==="all"||item.member.partition===partition)&&(status==="all"||statusOf(item)===status)&&item.claim.claim_id.toLowerCase().includes(search)});index=0;render()}
function exportProgress(){const reviews=payload.cases.map(function(item){return load(item)}).filter(function(state){return state.review_decision!=="draft"||state.analysis_support||Object.values(state.meanings).some(Boolean)||state.note});download("morphology-calibration.progress.json",JSON.stringify({format:"wordwell-review-progress/1",partition_version:payload.partition_version,evidence_digest:payload.evidence_digest,rubric_version:payload.rubric_version,reviews:reviews},null,2)+"\n","application/json")}
function exportLabels(){const labels=payload.cases.map(function(item){const state=load(item);if(!isValidated(item,state))return null;const result=dispositions(item,state);return {analysis_support:state.analysis_support,claim_id:item.claim.claim_id,effective_disposition:result.effective,endorsement_override:result.override,endorsements:item.endorsements,input_digest:item.claim.input_digest,label_status:"human-validated",meanings:item.claim.candidate.source_meanings.map(function(meaning){return {predictability:state.meanings[meaning.sense_id],sense_id:meaning.sense_id}}),morphology_disposition:result.morphology,note:state.note||"",partition:item.member.partition,review_decision:state.review_decision,rubric_version:payload.rubric_version,slice:item.member.primary_slice,validated_at:state.validated_at}}).filter(Boolean).sort(function(a,b){return a.claim_id<b.claim_id?-1:a.claim_id>b.claim_id?1:0});download("calibration-v1.validated.labels.jsonl",labels.map(function(label){return JSON.stringify(canonical(label))}).join("\n")+(labels.length?"\n":""),"application/x-ndjson")}
document.getElementById("previous").addEventListener("click",function(){if(index>0){index--;render();scrollTo(0,0)}});document.getElementById("next").addEventListener("click",function(){if(index+1<visible.length){index++;render();scrollTo(0,0)}});["partition-filter","status-filter"].forEach(function(id){document.getElementById(id).addEventListener("change",applyFilters)});document.getElementById("search").addEventListener("input",applyFilters);document.getElementById("export-progress").addEventListener("click",exportProgress);document.getElementById("export-labels").addEventListener("click",exportLabels);document.getElementById("import-progress").addEventListener("click",function(){document.getElementById("import-file").click()});document.getElementById("import-file").addEventListener("change",function(event){const file=event.target.files[0];if(!file)return;file.text().then(function(text){const imported=JSON.parse(text);if(imported.format!=="wordwell-review-progress/1"||imported.partition_version!==payload.partition_version||imported.evidence_digest!==payload.evidence_digest||imported.rubric_version!==payload.rubric_version||!Array.isArray(imported.reviews))throw new Error("Progress fingerprint does not match this review page.");const byId=new Map(payload.cases.map(function(item){return [item.claim.claim_id,item]}));imported.reviews.forEach(function(state){const item=byId.get(state.claim_id);if(!item||state.input_digest!==item.claim.input_digest)throw new Error("Progress contains an unknown or changed claim: "+state.claim_id);save(item,Object.assign(blank(item),state))});applyFilters();alert("Progress imported.")}).catch(function(error){alert(error.message)})});updateCounter();applyFilters();
</script>
</body>
</html>
`;
}

function parseArgs(args: string[]): { out: string; labels?: string } {
  let out = defaultOutput;
  const presentDefaults = defaultProvisionalPaths.filter((path) => existsSync(path));
  if (presentDefaults.length > 1) {
    throw new Error(`Multiple default provisional label files exist: ${presentDefaults.join(", ")}`);
  }
  let labels: string | undefined = presentDefaults[0];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") out = resolve(requireString(args[++index], "--out"));
    else if (arg === "--labels") labels = resolve(requireString(args[++index], "--labels"));
    else if (arg === "--no-labels") labels = undefined;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (labels && !existsSync(labels)) throw new Error(`Provisional labels do not exist: ${labels}`);
  return { out, labels };
}

export function main(args = process.argv.slice(2)): void {
  const options = parseArgs(args);
  const payload = assembleReviewPayload({
    evidencePath: defaultEvidence,
    partitionsPath: defaultPartitions,
    provisionalPath: options.labels,
  });
  const html = buildReviewHtml(payload);
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, html);
  const digest = createHash("sha256").update(html).digest("hex");
  console.log(`Wrote ${options.out} (${payload.cases.length} frozen cases, sha256 ${digest})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
