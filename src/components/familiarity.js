import { escapeHtml, renderButton } from "./button.js";

const choices = ["Completely new to me", "I think I've heard of it", "Familiar, but I don't use it", "I use it all the time"];

export function renderFamiliarityGate({ headword, revision = false } = {}) {
  return `<section class="familiarity-gate flow" aria-labelledby="familiarity-heading">
    <p class="lesson-label">${revision ? "Update familiarity" : "Before we begin"}</p>
    <p class="familiarity-word">${escapeHtml(headword)}</p>
    <h1 id="familiarity-heading" class="familiarity-title">${revision ? "How familiar does this word feel now?" : "How familiar is this word?"}</h1>
    <p class="familiarity-copy">${revision ? "This updates your reference point without adding new learning evidence." : "Your answer sets the starting point for practice. It is not a test."}</p>
    <div class="familiarity-actions">${choices.map((choice) => renderButton({ label: choice, action: "familiarity", value: choice })).join("")}</div>
  </section>`;
}
