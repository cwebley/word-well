/**
 * Button renderer — a pure function returning an HTML string.
 * Used by both the app (src/pages/home.js) and the pattern library
 * (swatchkit/swatches/button/index.js). One source of truth.
 *
 * @param {object} props
 * @param {string} props.label              - Visible button text
 * @param {string} [props.href]             - If set, renders an <a> instead of a <button>
 * @param {string} [props.action]           - Delegated browser action
 * @param {string} [props.value]            - Value for a delegated action
 * @param {"primary"|"outline"|"choice"} [props.variant] - Visual style (default: primary)
 * @param {"small"|"large"} [props.size]    - Optional size modifier
 * @param {boolean} [props.busy]            - Marks the button as a pending request, disables it, and sets aria-busy
 */
export function renderButton({ label, href, action, value, variant = "primary", size, busy = false } = {}) {
  const classes = ["button"];
  if (variant === "outline") classes.push("outline");
  else if (variant === "choice") classes.push("choice");
  if (size === "small") classes.push("small");
  else if (size === "large") classes.push("large");
  if (busy) classes.push("busy");

  const cls = classes.join(" ");
  const shared = [
    `class="${cls}"`,
    action ? `data-action="${escapeHtml(action)}"` : "",
    value ? `data-value="${escapeHtml(value)}"` : ""
  ].filter(Boolean).join(" ");
  if (href) {
    const aria = busy ? ` aria-disabled="true"` : "";
    return `<a ${shared} href="${escapeHtml(href)}"${aria}>${escapeHtml(label)}</a>`;
  }
  const busyAttrs = busy ? " disabled aria-busy=\"true\"" : "";
  return `<button ${shared} type="button"${busyAttrs}>${escapeHtml(label)}</button>`;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
