// Asks Jev a set of questions about every word in a usefulness dataset, three
// trials each, and writes the answers as a replay file. Used to measure a
// candidate question before it joins the gate. Answers already saved in a
// --replay-from file are reused, not bought again.
//
//   OPENROUTER_API_KEY=... npx tsx scripts/ask-jev.ts --dataset D --questions Q.json \
//     --out answers.json --attempts-dir DIR --max-requests N [--replay-from F ...]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { httpJev, JevError, replayJev, replayThenLive, type Questions } from "../pipeline/execution/jev.js";
import { MODEL, renderState, TRIALS } from "../pipeline/stages/usefulness.js";
import { loadUsefulnessDataset } from "../evals/datasets/usefulness.js";

const { values } = parseArgs({ options: {
  dataset: { type: "string" }, questions: { type: "string" }, out: { type: "string" },
  "attempts-dir": { type: "string" }, "max-requests": { type: "string" }, "replay-from": { type: "string", multiple: true }
} });
const maxRequests = Number(values["max-requests"]);
if (!values.dataset || !values.questions || !values.out || !values["attempts-dir"] || !(maxRequests > 0)) {
  throw new Error("Required: --dataset --questions --out --attempts-dir --max-requests");
}
if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");

const questions = JSON.parse(readFileSync(values.questions, "utf8")) as Questions;
const live = httpJev({ apiKey: process.env.OPENROUTER_API_KEY, maxRequests, attemptsDir: values["attempts-dir"] });
const jev = values["replay-from"]?.length ? replayThenLive(replayJev(values["replay-from"]), live) : live;
const answers: unknown[] = [];
const skipped: string[] = [];
for (const c of loadUsefulnessDataset(values.dataset).cases) {
  const state = renderState({ headword: c.headword, partsOfSpeech: c.partsOfSpeech });
  try {
    const trials = await Promise.all(Array.from({ length: TRIALS }, (_, i) => jev.ask({ model: MODEL, state, questions }, i + 1)));
    trials.forEach((t, i) => Object.entries(t).forEach(([question, answer]) => answers.push({ model: MODEL, state, question, trial: i + 1, answer })));
  } catch (e) {
    // One bad reply skips the word; anything that would repeat stops the run.
    if (!(e instanceof JevError) || e.kind !== "invalid") { writeOut(); throw e; }
    skipped.push(c.headword);
    if (skipped.length >= 3) { writeOut(); throw new Error(`Stopped after 3 invalid replies: ${skipped.join(", ")}`); }
  }
}
writeOut();
console.log(`${answers.length} answers, ${skipped.length} words skipped${skipped.length ? ": " + skipped.join(", ") : ""} -> ${values.out}`);

function writeOut() {
  writeFileSync(values.out!, JSON.stringify({ schema: "wordwell-jev-answers/v1", questions, answers }), { mode: 0o600 });
}
