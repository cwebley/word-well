import { renderButton } from "./button.js";

const html = String.raw;

/**
 * Card renderer — composes renderButton for its optional CTA.
 *
 * @param {object} props
 * @param {string} props.title         - Card heading
 * @param {string} props.body          - Card body text
 * @param {string} [props.ctaLabel]    - If set, renders a button in the footer
 * @param {string} [props.ctaHref]     - Optional href for the CTA
 */
export function renderCard({ title, body, ctaLabel, ctaHref } = {}) {
  const cta = ctaLabel
    ? html`<div class="card-footer">
        ${renderButton({ label: ctaLabel, href: ctaHref })}
      </div>`
    : "";
  return html`<article class="card flow">
    <h3 class="card-title">${title}</h3>
    <p class="card-body">${body}</p>
    ${cta}
  </article>`;
}
