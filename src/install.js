export function installCapability({ isIos, isChromium, hasDeferredPrompt }) {
  if (isIos) {
    return "ios_home_screen";
  }

  return isChromium || hasDeferredPrompt ? "chromium_prompt" : "unavailable";
}

export function createInstallation({ window, navigator, signals, onChange }) {
  let deferredPrompt;
  const capability = installCapability({
    isIos: /iPad|iPhone|iPod/.test(navigator.userAgent) || /iPad|iPhone|iPod/.test(navigator.platform) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    isChromium: /Chrome|Chromium|Edg/.test(navigator.userAgent) && !/Firefox|OPR/.test(navigator.userAgent),
    hasDeferredPrompt: false,
  });
  let shown = false;

  const state = () => ({ capability, canPrompt: Boolean(deferredPrompt) });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    onChange(state());
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = undefined;
    signals.record("install_confirmed", capability);
    onChange(state());
  });

  return {
    state,
    show() {
      if (!shown && (capability === "ios_home_screen" || deferredPrompt)) {
        shown = true;
        signals.record("install_cta_shown", capability);
      }
      return state();
    },
    async prompt() {
      if (!deferredPrompt) return;
      signals.record("install_cta_started", capability);
      await deferredPrompt.prompt();
      deferredPrompt = undefined;
      onChange(state());
    },
  };
}
