import { renderStatus } from "../../../src/components/status.js";

const html = String.raw;

export default html`
  <h2>Status states</h2>
  <div class="flow">
    ${renderStatus({ label: "You're offline", detail: "Your downloaded lessons remain available. New changes will wait until you reconnect." })}
    ${renderStatus({ label: "Nothing new is waiting", detail: "There is no lesson available for this starting band yet. Your current history is safe." })}
    ${renderStatus({ label: "Your word history will gather here", detail: "Complete today's lesson to start your record." })}
  </div>
`;
