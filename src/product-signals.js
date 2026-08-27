export function createProductSignals(hasConsent, send = sendToFirstParty) {
  return {
    record(event, capability) {
      if (!hasConsent()) {
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

function sendToFirstParty(signal) {
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signal),
    keepalive: true
  }).catch(() => {
    // Product analytics must not interfere with learning or installation.
  });
}
