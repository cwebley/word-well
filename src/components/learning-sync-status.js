import { renderButton } from "./button.js";

const html = String.raw;

export function renderLearningSyncStatus(status) {
  if (status === "offline") {
    return html`<aside class="sync-status" role="status"><p><strong>Offline</strong><span class="sync-status-detail"> Your changes will sync when you reconnect.</span></p>${renderButton({ label: "Retry", action: "retry-learning", size: "small" })}</aside>`;
  }
  if (status === "session-expired") {
    return html`<aside class="sync-status" role="status"><p><strong>Session expired</strong> Unsent changes remain on this device.</p></aside>`;
  }
  return "";
}
