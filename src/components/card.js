import { escapeHtml, renderButton } from "./button.js";
import { renderWordHero } from "./word-hero.js";

const html = String.raw;

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
    ? html`<div class="card-footer">
        ${renderButton({ label: ctaLabel, href: ctaHref })}
      </div>`
    : "";
  return html`<article class="card flow">
    <h3 class="card-title">${title}</h3>
    <p class="card-body">${body}</p>
    ${cta}
  </article>`;
}

export function renderLessonCard({ lesson }) {
  const partsOfSpeech = [...new Set(lesson.meanings.map((meaning) => meaning.partOfSpeech))].join(", ");
  const meanings = lesson.meanings
    .map((meaning, index) => {
      const examples = meaning.examples
        .map((example) => html`<li>“${escapeHtml(example)}”</li>`)
        .join("");
      const examplesId = `lesson-examples-${index}`;

      return html`<section class="word-lesson-meaning" aria-labelledby="lesson-meaning-${index}">
        <h2 id="lesson-meaning-${index}" class="visually-hidden">Meaning ${index + 1}</h2>
        <section class="flow word-lesson-definition">
          <p>${escapeHtml(meaning.definition)}.</p>
        </section>
        <section class="word-lesson-examples" aria-labelledby="${examplesId}">
          <p id="${examplesId}" class="lesson-label">In a sentence</p>
          <ol role="list">
            ${examples}
          </ol>
        </section>
        <dl class="lesson-guidance">
          <div class="lesson-guidance-use">
            <dt>Use it when</dt>
            <dd>${escapeHtml(meaning.useItWhen)}.</dd>
          </div>
          <div class="lesson-guidance-avoid">
            <dt>Do not use it for</dt>
            <dd>${escapeHtml(meaning.doNotUseItFor)}.</dd>
          </div>
        </dl>
      </section>`;
    })
    .join("");
  const etymology = lesson.etymology
    ? html`<section class="word-lesson-etymology">
        <p class="lesson-label">Where it comes from</p>
        <p>${escapeHtml(lesson.etymology)}</p>
      </section>`
    : "";

  return html`<article class="region word-lesson" aria-labelledby="lesson-word">
    ${renderWordHero({
      headword: lesson.headword,
      pronunciation: lesson.pronunciation,
      partOfSpeech: partsOfSpeech,
    })}
    <div class="region wrapper word-lesson-body region-space:space-xl">
      <div class="word-lesson-meanings">
        ${meanings}
      </div>
      ${etymology}
      <footer class="word-lesson-footer">
        <p>Also: ${[...new Set(lesson.meanings.flatMap((meaning) => meaning.synonyms))]
          .map(escapeHtml)
          .join(", ")}</p>
        <div class="word-feedback flow">
          <p>How is this word landing?</p>
          <div class="word-feedback-actions">
            ${renderButton({ label: "Useful to me", action: "utility", value: "useful", variant: "outline", size: "small" })}
            ${renderButton({ label: "Not useful to me", action: "utility", value: "not_useful", variant: "outline", size: "small" })}
            ${renderButton({ label: "I'm using this", action: "active-use", value: "using", variant: "outline", size: "small" })}
            ${renderButton({ label: "Not using it yet", action: "active-use", value: "not_using", variant: "outline", size: "small" })}
            ${renderButton({ label: "This seems wrong", action: "content-quality", variant: "outline", size: "small" })}
          </div>
        </div>
        ${renderButton({
          label: "Update familiarity",
          action: "revise-familiarity",
          variant: "outline",
          size: "small",
        })}
      </footer>
    </div>
  </article>`;
}
