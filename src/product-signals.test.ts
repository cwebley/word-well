import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { InstallApp, installCapability } from "./InstallApp";
import { createProductSignals } from "./product-signals";

describe("installation capability", () => {
  it.each([
    ["Chrome desktop", false, true, false, "chromium_prompt"],
    ["Edge desktop", false, true, false, "chromium_prompt"],
    ["Chromium Android", false, true, false, "chromium_prompt"],
    ["Safari iOS", true, false, false, "ios_home_screen"],
    ["Safari iPadOS", true, false, false, "ios_home_screen"],
    ["Firefox desktop", false, false, false, "unavailable"]
  ] as const)("uses the expected behavior on %s", (_, isIos, isChromium, hasDeferredPrompt, expected) => {
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

describe("install control", () => {
  it("defers the Chromium prompt until the learner presses Install app", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const record = vi.fn();
    render(createElement(InstallApp, { signals: { record } }));

    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt });
    window.dispatchEvent(event);

    const button = await screen.findByRole("button", { name: "Install app" });
    expect(prompt).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(record).toHaveBeenCalledWith("install_cta_shown", "chromium_prompt");
    });

    fireEvent.click(button);
    expect(prompt).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith("install_cta_started", "chromium_prompt");
  });

  it("records confirmation only when the browser reports installation", async () => {
    const record = vi.fn();
    render(createElement(InstallApp, { signals: { record } }));

    window.dispatchEvent(new Event("appinstalled"));

    expect(record).toHaveBeenCalledWith("install_confirmed", "chromium_prompt");
  });
});
