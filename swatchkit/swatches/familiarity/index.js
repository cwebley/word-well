import { renderFamiliarityGate } from "../../../src/components/familiarity.js";

const html = String.raw;

export default html`
  <h2>Familiarity gate</h2>
  <p>A direct, text-only familiarity ladder. Each choice advances the learner into today's lesson.</p>
  <div class="familiarity-preview">
    ${renderFamiliarityGate({ headword: "candid", pronunciation: "/ˈkændɪd/", partOfSpeech: "adjective" })}
  </div>
  <style>
    .familiarity-preview {
      container: app-shell / inline-size;
    }
  </style>
`;
