import { renderNavigation } from "../components/navigation.js";
import { renderStatus } from "../components/status.js";
import { escapeHtml } from "../components/button.js";

const html = String.raw;

export function home({ apiBaseUrl = process.env.API_BASE_URL ?? "" } = {}) {
  return html`<!doctype html>
    <html lang="en" data-api-base-url="${escapeHtml(apiBaseUrl)}">
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
          <main class="app-main" id="app-main" tabindex="-1">
            ${renderStatus({ label: "Today", detail: "Your next lesson will appear here after it is delivered." })}
          </main>
        </div>

        <script>
          if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
        </script>
        <script type="module" src="./js/main.js"></script>
      </body>
    </html>`;
}
