import { escapeHtml, renderButton } from "./button.js";

const html = String.raw;

export function renderLearningSyncStatus(status, { busy = false, error } = {}) {
  if (status === "offline") {
    return html`<aside class="sync-status" role="status"><p><strong>Offline</strong><span class="sync-status-detail"> Your changes will sync when you reconnect.</span></p>${renderButton({
      label: busy ? "Retrying…" : "Retry",
      action: "retry-learning",
      size: "small",
      busy,
    })}${syncError(error)}</aside>`;
  }
  if (status === "session-expired") {
    return html`<aside class="sync-status" role="status"><p><strong>Session expired</strong> Unsent changes remain on this device.</p></aside>`;
  }
  return "";
}

function syncError(message) {
  if (!message) return "";
  return html`<p class="sync-status-error" aria-live="polite">${escapeHtml(message)}</p>`;
}
