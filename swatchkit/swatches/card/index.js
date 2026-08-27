import { renderLessonCard } from "../../../src/components/card.js";
import { seededVocabularyRecord } from "../../../src/fixtures/published-word-lesson.js";

const html = String.raw;

export default html`
  <h2>Lesson card</h2>
  <p>
    The same <code>renderLessonCard</code> function used on WordWell's Today
    screen. It composes the shared action renderer.
  </p>

  ${renderLessonCard({ lesson: seededVocabularyRecord })}
`;
