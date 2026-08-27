import { renderFamiliarityGate } from "../components/familiarity.js";
import { renderNavigation } from "../components/navigation.js";

const html = String.raw;

export function home() {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#286b78" />
        <title>WordWell</title>
        <link rel="stylesheet" href="./css/main.css" />
      </head>
      <body>
        <div class="app-shell">
          ${renderNavigation()}
          <main class="app-main region wrapper" id="app-main" tabindex="-1">
            ${renderFamiliarityGate()}
          </main>
        </div>

        <script type="module" src="./js/main.js"></script>
      </body>
    </html>`;
}
