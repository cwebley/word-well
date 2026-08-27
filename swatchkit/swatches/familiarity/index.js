import { renderFamiliarityGate } from "../../../src/components/familiarity.js";

const html = String.raw;

export default html`
  <h2>Familiarity gate</h2>
  <p>The learner chooses a starting point before lesson content is revealed.</p>
  ${renderFamiliarityGate()}
`;
