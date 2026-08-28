import { escapeHtml } from "./button.js";

const html = String.raw;

const defaultItems = [
  { label: "Today", href: "#today", route: "today" },
  { label: "Practice", href: "#practice", route: "practice" },
  { label: "History", href: "#history", route: "history" },
  { label: "Profile", href: "#profile", route: "profile" },
];

/**
 * Navigation rail renderer shared by the app and the SwatchKit pattern library.
 *
 * @param {object} props
 * @param {string} [props.brand] - Wordmark text
 * @param {string} [props.current] - Route to mark as the active page
 * @param {string} [props.note] - Supporting copy below the links
 * @param {Array<{label: string, href: string, route: string}>} [props.items]
 */
export function renderNavigation({
  brand = "WordWell",
  current = "today",
  items = defaultItems,
} = {}) {
  const links = items
    .map(({ label, href, route }) => {
      const attributes = [
        `class="navigation-link"`,
        `href="${escapeHtml(href)}"`,
        `data-route="${escapeHtml(route)}"`,
        route === current ? `aria-current="page"` : "",
      ]
        .filter(Boolean)
        .join(" ");

      return html`<a ${attributes}>${escapeHtml(label)}</a>`;
    })
    .join("");

  return html`<aside class="navigation-rail flow flow-space:space-l">
      <h2>
        <a class="navigation-wordmark" href="#today">${escapeHtml(brand)}</a>
      </h2>
      <nav class="navigation" aria-label="Primary navigation">${links}</nav>
  </aside>`;
}

/**
 * Keeps the active-page state and its view transition local to one navigation
 * component. The application supplies its route update when needed.
 *
 * @param {HTMLElement | null} navigation
 * @param {{onNavigate?: (route: string) => void}} [options]
 */

export function bindNavigation(navigation, { onNavigate } = {}) {
  if (!navigation) return;

  navigation.addEventListener("click", (event) => {
    const target = event.target.closest("[data-route]");
    if (!target || !navigation.contains(target)) return;
    event.preventDefault();

    const update = () => {
      navigation
        .querySelectorAll("[data-route]")
        .forEach((link) => link.removeAttribute("aria-current"));
      target.setAttribute("aria-current", "page");
      onNavigate?.(target.dataset.route);
    };

    if (document.startViewTransition) document.startViewTransition(update);
    else update();
  });
}
