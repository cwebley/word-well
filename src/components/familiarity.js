import { renderButton } from "./button.js";

const choices = ["Never seen it", "Seen it, unsure", "Know the meaning", "Could use it naturally"];

export function renderFamiliarityGate({ revision = false } = {}) {
  return `<section class="card flow" aria-labelledby="familiarity-heading">
    <p class="lesson-label">${revision ? "Update familiarity" : "Before we begin"}</p>
    <h1 id="familiarity-heading" class="card-title">${revision ? "How familiar does this word feel now?" : "How familiar is this word?"}</h1>
    <p class="card-body">${revision ? "This updates your reference point without adding new learning evidence." : "Your answer sets the starting point for practice. It is not a test."}</p>
    <div class="flow">${choices.map((choice) => renderButton({ label: choice, action: "familiarity", value: choice, variant: "choice" })).join("")}</div>
  </section>`;
}
