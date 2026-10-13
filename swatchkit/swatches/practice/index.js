import { renderPractice } from "../../../src/components/practice.js";
import { versionedPractice } from "../../../src/fixtures/versioned-practice.js";
import { renderStatus } from "../../../src/components/status.js";

const html = String.raw;
const practice = versionedPractice;

export default html`
  <h2>Practice prompt and feedback</h2>
  <p>The same renderer presents contextual recall and its explanation.</p>
  <div class="flow">
    ${renderStatus({ label: "Practice", detail: "No Practice items are available for recall right now. You can still read your lessons." })}
    ${renderPractice({ practice })}
    ${renderPractice({ practice, result: true })}
    ${renderPractice({ practice, result: false })}
  </div>
`;
