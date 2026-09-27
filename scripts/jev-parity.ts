// Checks that OpenRouter's v1 System One route answers like the alpha route
// the lab used. Asks one live trial per word and compares each answer with
// the spread of the three saved alpha trials. Spends one request per word.
//
//   OPENROUTER_API_KEY=... npx tsx scripts/jev-parity.ts SAVED_ANSWERS_JSON ATTEMPTS_DIR word:pos [word:pos ...]
import { readFileSync } from "node:fs";
import { httpJev, type Answer } from "../pipeline/execution/jev.js";
import { MODEL, QUESTIONS, renderState } from "../pipeline/stages/usefulness.js";

const [savedPath, attemptsDir, ...words] = process.argv.slice(2);
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey || !words.length) throw new Error("Usage: OPENROUTER_API_KEY=... jev-parity.ts SAVED_ANSWERS ATTEMPTS_DIR word:pos ...");

const saved = JSON.parse(readFileSync(savedPath, "utf8")) as { answers: { state: string; question: string; trial: number; answer: Answer }[] };
const jev = httpJev({ apiKey, maxRequests: words.length, attemptsDir });
const TOLERANCE = 0.03;

// One number per answer for comparison: Noul value, score, or the chosen option's probability.
const value = (a: Answer, option?: string) => a.type === "noul" ? a.noul : a.type === "score" ? a.score : a.probabilities[option ?? a.choice];

let outside = 0;
for (const word of words) {
  const [headword, pos] = word.split(":");
  const state = renderState({ headword, partsOfSpeech: pos ? pos.split(",") : [] });
  const live = await jev.ask({ model: MODEL, state, questions: QUESTIONS }, 1);
  console.log(`\n${headword}`);
  for (const name of Object.keys(QUESTIONS)) {
    const trials = saved.answers.filter((a) => a.state === state && a.question === name).map((a) => a.answer);
    if (trials.length !== 3) throw new Error(`${headword} ${name}: expected 3 saved trials, found ${trials.length}`);
    const now = live[name];
    const option = now.type === "choice" ? trials[0].type === "choice" ? trials[0].choice : undefined : undefined;
    const old = trials.map((t) => value(t, option));
    const v = value(now, option);
    const ok = v >= Math.min(...old) - TOLERANCE && v <= Math.max(...old) + TOLERANCE
      && (now.type !== "choice" || trials.every((t) => t.type === "choice" && t.choice === now.choice));
    if (!ok) outside += 1;
    const label = now.type === "choice" ? `${now.choice} ${v.toFixed(2)}` : v.toFixed(3);
    console.log(`  ${ok ? "ok  " : "DIFF"} ${name.padEnd(24)} v1 ${label.padEnd(22)} alpha ${old.map((x) => x.toFixed(3)).join(" / ")}`);
  }
}
console.log(`\n${outside} answers outside the saved spread ±${TOLERANCE}`);
