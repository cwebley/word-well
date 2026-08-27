import { escapeHtml } from "./button.js";

export function renderStatus({ label, detail }) {
  return `<aside class="status flow" role="status"><p class="status-label">${escapeHtml(label)}</p><p>${escapeHtml(detail)}</p></aside>`;
}
