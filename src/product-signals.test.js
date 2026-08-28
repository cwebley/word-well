import { describe, expect, it, vi } from "vitest";
import { createInstallation, installCapability } from "./install.js";
import { createProductSignals } from "./product-signals.js";

describe("installation capability", () => {
  it.each([
    ["Chrome desktop", false, true, false, "chromium_prompt"],
    ["Edge desktop", false, true, false, "chromium_prompt"],
    ["Chromium Android", false, true, false, "chromium_prompt"],
    ["Safari iOS", true, false, false, "ios_home_screen"],
    ["Safari iPadOS", true, false, false, "ios_home_screen"],
    ["Firefox desktop", false, false, false, "unavailable"]
  ])("uses the expected behavior on %s", (_, isIos, isChromium, hasDeferredPrompt, expected) => {
    expect(installCapability({ isIos, isChromium, hasDeferredPrompt })).toBe(expected);
  });

  it.each([
    ["Chrome desktop", "Chrome", "MacIntel", 0, "chromium_prompt"],
    ["Edge desktop", "Edg", "Win32", 0, "chromium_prompt"],
    ["Chromium Android", "Chrome", "Linux armv8l", 0, "chromium_prompt"],
    ["Safari iOS", "Safari", "iPhone", 0, "ios_home_screen"],
    ["Safari iPadOS", "Safari", "MacIntel", 5, "ios_home_screen"],
    ["Firefox desktop", "Firefox", "MacIntel", 0, "unavailable"],
  ])("detects %s using the runtime platform data", (_, userAgent, platform, maxTouchPoints, expected) => {
    const installation = createInstallation({
      window: new EventTarget(),
      navigator: { userAgent, platform, maxTouchPoints },
      signals: createProductSignals(() => false),
      onChange: () => {},
    });

    expect(installation.state().capability).toBe(expected);
  });
});

describe("product signals", () => {
  it("does not send signals before consent", () => {
    const send = vi.fn();
    createProductSignals(() => false, send).record("install_cta_shown", "chromium_prompt");

    expect(send).not.toHaveBeenCalled();
  });

  it("sends only the fixed install payload after consent", () => {
    const send = vi.fn();
    createProductSignals(() => true, send).record("install_confirmed", "ios_home_screen");

    expect(send).toHaveBeenCalledWith({
      event: "install_confirmed",
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      capability: "ios_home_screen"
    });
  });

  it("rejects event names and capabilities outside the fixed allowlist", () => {
    const send = vi.fn();
    createProductSignals(() => true, send).record("lesson_read", "device-123");

    expect(send).not.toHaveBeenCalled();
  });

  it("defers the Chromium prompt until the learner starts it and records browser confirmation", async () => {
    const send = vi.fn();
    const onChange = vi.fn();
    const prompt = vi.fn();
    const installation = createInstallation({
      window,
      navigator: { userAgent: "Chrome", platform: "MacIntel", maxTouchPoints: 0 },
      signals: createProductSignals(() => true, send),
      onChange
    });
    const event = new Event("beforeinstallprompt");
    event.prompt = prompt;
    window.dispatchEvent(event);

    expect(prompt).not.toHaveBeenCalled();
    installation.show();
    await installation.prompt();
    window.dispatchEvent(new Event("appinstalled"));

    expect(prompt).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event: "install_cta_started", capability: "chromium_prompt" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ event: "install_confirmed", capability: "chromium_prompt" }));
  });
});
