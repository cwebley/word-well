import { projectPublishedLesson } from "../lesson-contract.js";
import { escapeHtml } from "./button.js";
import { renderWordHero } from "./word-hero.js";
import { renderLessonFeedback } from "./lesson-feedback.js";

const list = values => values.map(value => `<li>${escapeHtml(value)}</li>`).join("");
const link = (url, label) => `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;

export function renderPublishedLesson({ lesson: value }) {
  const lesson = projectPublishedLesson(value);
  const citations = refs => refs.map(ref => {
    const index = lesson.sources.findIndex(source => source.id === ref);
    return `<a href="#lesson-source-${index}">${escapeHtml(lesson.sources[index].name)}</a>`;
  }).join(", ");
  const note = value => `<p>${escapeHtml(value.text)} <span class="lesson-source-reference">${citations(value.sourceRefs)}</span></p>`;
  const meanings = lesson.meanings.map((meaning, index) => `<section class="word-lesson-meaning" data-meaning-id="${escapeHtml(meaning.id)}" aria-labelledby="lesson-meaning-${index}">
    <h2 id="lesson-meaning-${index}">Meaning ${index + 1} <span class="lesson-label">${escapeHtml(meaning.partOfSpeech)}</span></h2>
    <p class="word-lesson-definition">${escapeHtml(meaning.definition)}</p>
    <section class="word-lesson-examples" aria-labelledby="lesson-examples-${index}">
      <h3 id="lesson-examples-${index}" class="lesson-label">In a sentence</h3>
      <ol>${list(meaning.examples)}</ol>
    </section>
    <dl class="lesson-guidance">
      <div class="lesson-guidance-use"><dt>Use it when</dt><dd>${escapeHtml(meaning.useItWhen)}</dd></div>
      <div class="lesson-guidance-avoid"><dt>Do not use it for</dt><dd>${escapeHtml(meaning.doNotUseItFor)}</dd></div>
    </dl>
    <section class="word-lesson-patterns"><h3 class="lesson-label">Common patterns</h3><ul>${list(meaning.commonPatterns)}</ul></section>
    ${meaning.synonyms.length ? `<section class="word-lesson-contrasts"><h3 class="lesson-label">Synonym contrasts</h3>
      <table><caption>What each synonym carries relative to ${escapeHtml(lesson.headword)}</caption>
        <thead><tr><th scope="col">Synonym</th><th scope="col">More of</th><th scope="col">Less of</th></tr></thead>
        <tbody>${meaning.synonyms.map(contrast => `<tr><th scope="row">${escapeHtml(contrast.synonym)}</th><td>${escapeHtml(contrast.more ?? "No supported difference")}</td><td>${escapeHtml(contrast.less ?? "No supported difference")}</td></tr>`).join("")}</tbody>
      </table></section>` : ""}
    ${meaning.usageNotes.length ? `<section class="word-lesson-usage"><h3 class="lesson-label">Usage notes</h3>${meaning.usageNotes.map(note).join("")}</section>` : ""}
    ${meaning.originNote ? `<section class="word-lesson-origin"><h3 class="lesson-label">Origin note</h3>${note(meaning.originNote)}</section>` : ""}
  </section>`).join("");
  const sources = lesson.sources.map((source, index) => `<li id="lesson-source-${index}">
    <p>${link(source.url, source.name)} ${escapeHtml(source.release)}</p>
    <p>License: ${link(source.license.url, source.license.name)}</p>
    <ul>${list(source.credits)}${list(source.notices)}</ul>
    <p>${escapeHtml(source.changes)}</p>
    ${source.revisionUrl ? `<p>${link(source.revisionUrl, "Source revision")}</p>` : ""}
    ${source.historyUrl ? `<p>${link(source.historyUrl, "Contributor history")}</p>` : ""}
  </li>`).join("");
  return `<article class="region word-lesson" data-lesson-id="${escapeHtml(lesson.lessonId)}" data-publication-version="${lesson.publicationVersion}" aria-labelledby="lesson-word">
    ${renderWordHero({ headword: lesson.headword, pronunciation: lesson.pronunciation.text, partOfSpeech: [...new Set(lesson.meanings.map(meaning => meaning.partOfSpeech))].join(", ") })}
    <div class="region wrapper word-lesson-body region-space:space-xl">
      <p class="lesson-pronunciation-source">${escapeHtml(lesson.pronunciation.dialect)} ${citations([lesson.pronunciation.sourceRef])}</p>
      <div class="word-lesson-meanings">${meanings}</div>
      ${lesson.wordFamily.length ? `<section class="word-lesson-family"><h2 class="lesson-label">Word family</h2><ul>${list(lesson.wordFamily)}</ul></section>` : ""}
      ${lesson.etymology ? `<section class="word-lesson-etymology"><h2 class="lesson-label">Where it comes from</h2><p>${escapeHtml(lesson.etymology.text)} ${citations([lesson.etymology.sourceRef])}</p></section>` : ""}
      <section class="word-lesson-sources" aria-labelledby="lesson-sources">
        <h2 id="lesson-sources">Sources and license</h2><ol>${sources}</ol>
        <p>WordWell contributions and assembled lesson: ${link(lesson.license.url, lesson.license.name)}. Upstream source licenses and notices apply to their material.</p>
        <p>Publication ${lesson.publicationVersion}</p>
      </section>
      <footer class="word-lesson-footer">${renderLessonFeedback()}</footer>
    </div>
  </article>`;
}
