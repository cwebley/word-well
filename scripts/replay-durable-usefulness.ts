// Replay an existing experiment against the durable stage without rewriting it.
// Output is counts/identities only. No provider or database is initialized.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { digest, PrivateError } from "../pipeline/storage/crypto.js";
import { PINNED_MODEL_VERSION, replayJev } from "../pipeline/execution/jev.js";
import { combineTrials, createUsefulnessStage, usefulnessConfiguration, renderState } from "../pipeline/stages/usefulness.js";
import { PRODUCTION_COMBINER } from "../pipeline/stages/usefulness-production.js";

const { values } = parseArgs({ options: { baseline: { type: "string" }, answers: { type: "string" } } });
if (!values.baseline || !values.answers) throw new PrivateError("explicit_saved_evidence_required");
let calls = 0;
globalThis.fetch = async () => { calls++; throw new PrivateError("network_forbidden"); };
const bytes = await readFile(values.baseline), answerBytes = await readFile(values.answers);
const baseline = z.object({ combinerId: z.literal(PRODUCTION_COMBINER.id), rows: z.array(z.object({ headword: z.string(), result: z.object({
  keepScore: z.number(), verdict: z.enum(["advance", "exclude"]), configId: z.string(), trials: z.array(z.object({ keepScore: z.number(), verdict: z.enum(["advance", "exclude"]) }).passthrough()).length(3)
}).nullable() }).passthrough()) }).passthrough().parse(JSON.parse(bytes.toString()));
const saved = z.object({ answers: z.array(z.object({ state: z.string() }).passthrough()) }).passthrough().parse(JSON.parse(answerBytes.toString()));
const replay = replayJev([values.answers]), stage = createUsefulnessStage(usefulnessConfiguration(PRODUCTION_COMBINER));
let cases = 0, trials = 0, admitted = 0;
for (const row of baseline.rows) {
  if (!row.result) throw new PrivateError("incomplete_baseline");
  const prefix = `HEADWORD\nword: ${row.headword}\nrecorded parts of speech: `;
  const states = [...new Set(saved.answers.filter(a => a.state.startsWith(prefix)).map(a => a.state))];
  if (states.length !== 1) throw new PrivateError("saved_subject_ambiguous");
  const pos = states[0].slice(prefix.length), input = { headword: row.headword, partsOfSpeech: pos === "none recorded" ? [] : pos.split(", ") };
  if (renderState(input) !== states[0]) throw new PrivateError("saved_subject_mismatch");
  const validated = [];
  for (let index = 1; index <= 3; index++) {
    const answers = await replay.ask(stage.render(input) as Parameters<typeof replay.ask>[0], index);
    const result = stage.validate(JSON.stringify({ model: PINNED_MODEL_VERSION, answers }));
    if (!result.ok || result.result.keepScore !== row.result.trials[index - 1].keepScore || result.result.verdict !== row.result.trials[index - 1].verdict) throw new PrivateError("saved_trial_mismatch");
    validated.push(result.result.answers); trials++;
  }
  const result = combineTrials(validated, PRODUCTION_COMBINER);
  if (result.keepScore !== row.result.keepScore || result.verdict !== row.result.verdict || result.configId !== row.result.configId) throw new PrivateError("saved_aggregate_mismatch");
  cases++; if (result.verdict === "advance") admitted++;
}
if (digest(await readFile(values.baseline)) !== digest(bytes) || digest(await readFile(values.answers)) !== digest(answerBytes)) throw new PrivateError("saved_evidence_changed");
console.log(JSON.stringify({ cases, trials, admitted, scoresAndVerdictsExact: true, originalFilesUnchanged: true, modelCalls: calls,
  baselineSha256: digest(bytes), answersSha256: digest(answerBytes), stageFingerprint: stage.fingerprint }));
