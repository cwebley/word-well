import { escapeHtml } from "./button.js";

const html = String.raw;

/**
 * Word hero — the pinned-to-top headword panel shared by the familiarity gate
 * and the word lesson reading page. Owns the headword itself, and
 * the pronunciation/part-of-speech line.
 *
 * @param {object} props
 * @param {string} props.headword        - The word being taught
 * @param {string} [props.pronunciation] - IPA string, e.g. "/ˈkændɪd/"
 * @param {string} [props.partOfSpeech]  - "adjective", "verb", etc.
 * @param {string} [props.headingId]     - Optional id for the h1 (a11y hook)
 * @param {boolean} [props.pinned]      - Render the sticky pinned bar
 */
export function renderWordHero({
  headword,
  pronunciation,
  partOfSpeech,
  headingId = "lesson-word",
  pinned = true,
} = {}) {
  const metadata = [pronunciation, partOfSpeech]
    .filter(Boolean)
    .map(escapeHtml)
    .join(" · ");
  const pinnedRow = pinned
    ? html`<div class="word-hero-pinned" aria-hidden="true">
        <span class="word-hero-pinned-word">${escapeHtml(headword)}</span>
        ${metadata
          ? html`<span class="word-hero-pinned-meta">${metadata}</span>`
          : ""}
      </div>`
    : "";

  return html`
    <header class="region wrapper word-hero">
      <h1 id="${escapeHtml(headingId)}" class="word-hero-word">
        ${escapeHtml(headword)}
      </h1>
      ${metadata ? html`<p class="word-hero-meta">${metadata}</p>` : ""}
      ${pinnedRow}
    </header>
  `;
}
