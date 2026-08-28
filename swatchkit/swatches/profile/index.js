import { renderProfile } from "../../../src/components/profile.js";

const html = String.raw;

export default html`
  <h2>Profile protection</h2>
  <p>The same profile renderer used by the learner app, covering anonymous continuity, passkeys, recovery, and permanent deletion.</p>
  ${renderProfile({ profile: { state: "anonymous", canProtect: true } })}
  ${renderProfile({ profile: { state: "protected", passkeys: [{ id: "laptop", label: "Laptop" }], recoveryEmail: "learner@example.com" } })}
`;
