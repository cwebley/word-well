import { renderLessonCard } from "../../../src/components/card.js";
import { seededVocabularyRecord } from "../../../src/fixtures/published-word-lesson.js";

const html = String.raw;

export default html`
  <h2>Word lesson</h2>
  <p>
    The same <code>renderLessonCard</code> function used on WordWell's Today
    screen. It presents a reading-first word lesson with three examples,
    rule-bar guidance, etymology, and the shared familiarity action.
  </p>

  ${renderLessonCard({ lesson: seededVocabularyRecord })}
`;
