import { renderPublishedLesson } from "../../../src/components/published-lesson.js";
import { multiMeaningWordLesson } from "../../../src/fixtures/versioned-word-lesson.js";

const html = String.raw;

export default html`
  <h2>Word lesson</h2>
  <p>
    The same <code>renderPublishedLesson</code> function used on WordWell's Today
    and history screens. This synthetic fixture shows all public fields, source
    notices and licensing. Its Practice bank is empty.
  </p>

  ${renderPublishedLesson({ lesson: multiMeaningWordLesson })}
`;
