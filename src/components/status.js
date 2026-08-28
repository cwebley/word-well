import { escapeHtml } from "./button.js";

const html = String.raw;

export function renderStatus({ label, detail }) {
  return html`<aside class="status flow" role="status"><p class="status-label">${escapeHtml(label)}</p><p>${escapeHtml(detail)}</p></aside>`;
}
