import { escapeHtml, renderButton } from "./button.js";

/**
 * Card renderer — composes renderButton for its optional CTA.
 *
 * @param {object} props
 * @param {string} props.title         - Card heading
 * @param {string} props.body          - Card body text
 * @param {string} [props.ctaLabel]    - If set, renders a button in the footer
 * @param {string} [props.ctaHref]     - Optional href for the CTA
 */
export function renderCard({ title, body, ctaLabel, ctaHref } = {}) {
  const cta = ctaLabel
    ? `<div class="card-footer">${renderButton({ label: ctaLabel, href: ctaHref })}</div>`
    : "";
  return `<article class="card flow">
  <h3 class="card-title">${title}</h3>
  <p class="card-body">${body}</p>
  ${cta}
</article>`;
}

export function renderLessonCard({ lesson }) {
  const meaning = lesson.meanings[0];
  return `<article class="card flow" aria-labelledby="lesson-word">
    <p class="lesson-label">Today's word</p>
    <h1 id="lesson-word" class="lesson-word">${escapeHtml(lesson.headword)}</h1>
    <p class="lesson-pronunciation">${escapeHtml(lesson.pronunciation)} · ${escapeHtml(meaning.partOfSpeech)}</p>
    <p class="lesson-definition">${escapeHtml(meaning.definition)}.</p>
    <p class="lesson-example">“${escapeHtml(meaning.example)}”</p>
    <dl class="lesson-guidance"><div><dt>Use it when</dt><dd>${escapeHtml(meaning.useItWhen)}.</dd></div><div><dt>Don't use it for</dt><dd>${escapeHtml(meaning.doNotUseItFor)}.</dd></div></dl>
    <p>Also: ${meaning.synonyms.map(escapeHtml).join(", ")}</p>
    ${renderButton({ label: "Update familiarity", action: "revise-familiarity", variant: "outline", size: "small" })}
  </article>`;
}
