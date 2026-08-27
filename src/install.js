export function installCapability({ isIos, isChromium, hasDeferredPrompt }) {
  if (isIos) {
    return "ios_home_screen";
  }

  return isChromium || hasDeferredPrompt ? "chromium_prompt" : "unavailable";
}
