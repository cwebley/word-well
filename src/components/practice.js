import { escapeHtml, renderButton } from "./button.js";

const html = String.raw;

export function renderPractice({ practice, result }) {
  if (result !== undefined) {
    return html`<section class="practice practice-feedback region region-space:space-l" aria-live="polite"><div class="wrapper"><div class="practice-inner flow"><h1 class="practice-question">${result ? "That fits" : "Try this distinction"}</h1><p class="practice-explanation">${escapeHtml(practice.explanation)}</p><p class="practice-next">Your next recall will appear when it is due.</p></div></div></section>`;
  }

  return html`<section class="practice region region-space:space-l" aria-labelledby="practice-heading"><div class="wrapper"><div class="practice-inner flow"><h1 id="practice-heading" class="practice-question">${escapeHtml(practice.prompt)}</h1><p class="practice-context">Choose the sentence that gives the word its proper work.</p><div class="practice-choices">${renderButton({ label: practice.correctSentence, action: "practice-answer", value: "correct", variant: "choice", size: "large" })}${renderButton({ label: practice.incorrectSentence, action: "practice-answer", value: "incorrect", variant: "choice", size: "large" })}</div></div></div></section>`;
}
