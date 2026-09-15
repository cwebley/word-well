import { renderPractice } from "../../../src/components/practice.js";
import { seededVocabularyRecord } from "../../../src/fixtures/published-word-lesson.js";

const html = String.raw;
const practice = seededVocabularyRecord.meanings[0].practice;

export default html`
  <h2>Practice prompt and feedback</h2>
  <p>The same renderer presents contextual recall and its explanation.</p>
  <div class="flow">
    ${renderPractice({ practice })}
    ${renderPractice({ practice, result: true })}
    ${renderPractice({ practice, result: false })}
  </div>
`;
