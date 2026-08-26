export type InstallCapability =
  | "chromium_prompt"
  | "ios_home_screen"
  | "unavailable";

export type InstallSignalName =
  | "install_cta_shown"
  | "install_cta_started"
  | "install_confirmed";

export type InstallSignal = {
  event: InstallSignalName;
  day: string;
  capability: InstallCapability;
};

type SendSignal = (signal: InstallSignal) => void;

export function createProductSignals(
  hasConsent: () => boolean,
  send: SendSignal = sendToFirstParty
) {
  return {
    record(event: InstallSignalName, capability: InstallCapability) {
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

function sendToFirstParty(signal: InstallSignal) {
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signal),
    keepalive: true
  }).catch(() => {
    // Product analytics must not interfere with learning or installation.
  });
}
