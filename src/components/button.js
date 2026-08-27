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
 */
export function renderButton({ label, href, action, value, variant = "primary", size } = {}) {
  const classes = ["button"];
  if (variant === "outline") classes.push("outline");
  else if (variant === "choice") classes.push("choice");
  if (size === "small") classes.push("small");
  else if (size === "large") classes.push("large");

  const cls = classes.join(" ");
  const attributes = [
    `class="${cls}"`,
    action ? `data-action="${escapeHtml(action)}"` : "",
    value ? `data-value="${escapeHtml(value)}"` : ""
  ].filter(Boolean).join(" ");
  return href
    ? `<a ${attributes} href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : `<button ${attributes} type="button">${escapeHtml(label)}</button>`;
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
