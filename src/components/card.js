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
  const examples = meaning.examples.map((example) => `<li>“${escapeHtml(example)}”</li>`).join("");
  const etymology = lesson.etymology
    ? `<section class="word-lesson-etymology"><p class="lesson-label">Where it comes from</p><p>${escapeHtml(lesson.etymology)}</p></section>`
    : "";

  return `<article class="word-lesson" aria-labelledby="lesson-word">
    <div class="word-lesson-pinned" aria-hidden="true"><span class="word-lesson-pinned-word">${escapeHtml(lesson.headword)}</span><span class="word-lesson-pinned-meta">${escapeHtml(lesson.pronunciation)} · ${escapeHtml(meaning.partOfSpeech)}</span></div>
    <header class="word-lesson-hero"><p class="lesson-label">Today's word</p><h1 id="lesson-word" class="lesson-word">${escapeHtml(lesson.headword)}</h1><p class="lesson-pronunciation">${escapeHtml(lesson.pronunciation)} · ${escapeHtml(meaning.partOfSpeech)}</p></header>
    <div class="word-lesson-body">
      <section class="word-lesson-definition"><p class="lesson-label">In brief</p><p>${escapeHtml(meaning.definition)}.</p></section>
      <section class="word-lesson-examples" aria-labelledby="lesson-examples"><p id="lesson-examples" class="lesson-label">In a sentence</p><ol role="list">${examples}</ol></section>
      <dl class="lesson-guidance"><div class="lesson-guidance-use"><dt>Use it when</dt><dd>${escapeHtml(meaning.useItWhen)}.</dd></div><div class="lesson-guidance-avoid"><dt>Do not use it for</dt><dd>${escapeHtml(meaning.doNotUseItFor)}.</dd></div></dl>
      ${etymology}
      <footer class="word-lesson-footer"><p>Also: ${meaning.synonyms.map(escapeHtml).join(", ")}</p>${renderButton({ label: "Update familiarity", action: "revise-familiarity", variant: "outline", size: "small" })}</footer>
    </div>
  </article>`;
}
