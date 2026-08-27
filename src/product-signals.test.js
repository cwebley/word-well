import { describe, expect, it, vi } from "vitest";
import { installCapability } from "./install.js";
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
});
