import { escapeHtml, renderButton } from "./button.js";
import { renderWordHero } from "./word-hero.js";

const html = String.raw;

const choices = [
  "Completely new to me",
  "I think I've heard of it",
  "Familiar, but I don't use it",
  "I use it all the time",
];

export function renderFamiliarityGate({ headword, partOfSpeech, pronunciation, revision = false } = {}) {
  return html`<section class="familiarity-gate" aria-labelledby="familiarity-heading">
    ${renderWordHero({ headword, pronunciation, partOfSpeech, pinned: false, eyebrow: "Today's word" })}
    <div class="familiarity-prompt flow">
      <h1 id="familiarity-heading" class="familiarity-title">${revision ? "How familiar does this word feel now?" : "How familiar is this word?"}</h1>
      <p class="familiarity-copy">${revision ? "This updates your reference point without adding new learning evidence." : "Your answer sets the starting point for practice. It is not a test."}</p>
      <div class="familiarity-actions">${choices.map((choice) => renderButton({ label: choice, action: "familiarity", value: choice })).join("")}</div>
    </div>
  </section>`;
}
