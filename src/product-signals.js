export function createProductSignals(hasConsent, send = sendToFirstParty) {
  return {
    record(event, capability) {
      if (!hasConsent() || !events.has(event) || !capabilities.has(capability)) {
        return;
      }

      send({
        event,
        day: new Date().toISOString().slice(0, 10),
        capability
      });
    }
  };
}

const events = new Set([
  "install_cta_shown",
  "install_cta_started",
  "install_confirmed",
]);
const capabilities = new Set(["chromium_prompt", "ios_home_screen"]);

function sendToFirstParty(signal) {
  const baseUrl = document.documentElement.dataset.apiBaseUrl ?? "";
  void fetch(`${baseUrl}/product-signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signal),
    keepalive: true
  }).catch(() => {
    // Product analytics must not interfere with learning or installation.
  });
}
