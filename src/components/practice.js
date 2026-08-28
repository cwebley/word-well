import { escapeHtml, renderButton } from "./button.js";

const html = String.raw;

export function renderPractice({ practice, result }) {
  if (result !== undefined) {
    return html`<section class="card practice-feedback flow" aria-live="polite"><h1 class="card-title">${result ? "That fits" : "Try this distinction"}</h1><p class="card-body">${escapeHtml(practice.explanation)}</p><p class="practice-next">Your next recall will appear when it is due.</p></section>`;
  }

  return html`<section class="card practice flow" aria-labelledby="practice-heading"><h1 id="practice-heading" class="card-title">${escapeHtml(practice.prompt)}</h1><div class="practice-choices">${renderButton({ label: practice.correctSentence, action: "practice-answer", value: "correct", variant: "choice", size: "large" })}${renderButton({ label: practice.incorrectSentence, action: "practice-answer", value: "incorrect", variant: "choice", size: "large" })}</div></section>`;
}
