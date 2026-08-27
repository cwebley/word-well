import { renderFamiliarityGate } from "../../../src/components/familiarity.js";

const html = String.raw;

export default html`
  <h2>Familiarity gate</h2>
  <p>A direct, text-only familiarity ladder. Each choice advances the learner into today's lesson.</p>
  ${renderFamiliarityGate({ headword: "candid" })}
`;
