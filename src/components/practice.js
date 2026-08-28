import { escapeHtml, renderButton } from "./button.js";

const html = String.raw;

export function renderPractice({ practice, result }) {
  if (result !== undefined) {
    return html`<section class="card flow" aria-live="polite"><p class="lesson-label">${result ? "That fits" : "Try this distinction"}</p><h1 class="card-title">${result ? "A natural use of the word" : "Not quite this time"}</h1><p class="card-body">${escapeHtml(practice.explanation)}</p>${renderButton({ label: "Practice again", action: "practice-reset", variant: "outline" })}</section>`;
  }

  return html`<section class="card flow" aria-labelledby="practice-heading"><p class="lesson-label">Practice</p><h1 id="practice-heading" class="card-title">${escapeHtml(practice.prompt)}</h1><div class="flow">${renderButton({ label: practice.correctSentence, action: "practice-answer", value: "correct", variant: "choice" })}${renderButton({ label: practice.incorrectSentence, action: "practice-answer", value: "incorrect", variant: "choice" })}</div></section>`;
}
