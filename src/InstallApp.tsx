import { useEffect, useRef, useState } from "react";
import type { InstallCapability } from "./product-signals";

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
};

type ProductSignals = {
  record: (event: "install_cta_shown" | "install_cta_started" | "install_confirmed", capability: InstallCapability) => void;
};

type InstallAppProps = {
  signals: ProductSignals;
};

export function installCapability({
  isIos,
  isChromium,
  hasDeferredPrompt
}: {
  isIos: boolean;
  isChromium: boolean;
  hasDeferredPrompt: boolean;
}): InstallCapability {
  if (isIos) {
    return "ios_home_screen";
  }

  return isChromium || hasDeferredPrompt ? "chromium_prompt" : "unavailable";
}

export function InstallApp({ signals }: InstallAppProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<DeferredInstallPrompt>();
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [installStatus, setInstallStatus] = useState<string>();
  const shownCapability = useRef<InstallCapability | undefined>(undefined);
  const isIos = isAppleMobile();
  const capability = installCapability({
    isIos,
    isChromium: isChromium(),
    hasDeferredPrompt: Boolean(deferredPrompt)
  });

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as DeferredInstallPrompt);
    };
    const confirmInstall = () => {
      signals.record("install_confirmed", "chromium_prompt");
      setDeferredPrompt(undefined);
    };

    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", confirmInstall);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", confirmInstall);
    };
  }, [signals]);

  useEffect(() => {
    if (capability !== "unavailable" && shownCapability.current !== capability) {
      signals.record("install_cta_shown", capability);
      shownCapability.current = capability;
    }
  }, [capability, signals]);

  if (capability === "unavailable") {
    return null;
  }

  async function startInstall() {
    signals.record("install_cta_started", capability);

    if (capability === "ios_home_screen") {
      setShowIosInstructions(true);
      return;
    }

    if (deferredPrompt) {
      await deferredPrompt.prompt();
      return;
    }

    setInstallStatus("Installation is not available in this browser session.");
  }

  return (
    <section className="install-app" aria-label="Install WordWell">
      <button className="install-button" type="button" onClick={startInstall}>
        Install app
      </button>
      {showIosInstructions && (
        <p role="status">
          In Safari, tap Share, then Add to Home Screen.
        </p>
      )}
      {installStatus && <p role="status">{installStatus}</p>}
    </section>
  );
}

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isChromium() {
  return /Chrome|Chromium|Edg\//.test(navigator.userAgent) && !/Firefox/.test(navigator.userAgent);
}
