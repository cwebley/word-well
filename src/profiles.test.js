import { describe, expect, it } from "vitest";
import { Profiles } from "./profiles.js";
import { WebAuthnSimulator } from "./webauthn-simulator.js";

function setup() {
  let time = new Date("2026-08-27T12:00:00Z");
  const webauthn = new WebAuthnSimulator();
  const profiles = new Profiles({ webauthn, now: () => time });
  return { profiles, webauthn, setTime: (next) => { time = new Date(next); } };
}

describe("learner profile seam", () => {
  it("offers protection only after meaningful history or history access, never on creation", () => {
    const { profiles, webauthn } = setup();
    const { session } = profiles.createAnonymousProfile();

    expect(profiles.profile(session.id).canProtect).toBe(false);
    expect(() => profiles.protect(session.id, webauthn.createPasskey())).toThrow("not available");
    profiles.accessHistory(session.id);

    expect(profiles.protect(session.id, webauthn.createPasskey("Laptop"))).toMatchObject({ state: "protected", passkeys: [{ label: "Laptop" }] });
  });

  it("supports multiple passkeys, verified recovery email, and recovery into the same profile", () => {
    const { profiles, webauthn } = setup();
    const { session, profile: anonymous } = profiles.createAnonymousProfile();
    profiles.accessHistory(session.id);
    const laptop = webauthn.createPasskey("Laptop");
    profiles.protect(session.id, laptop);
    const phone = webauthn.createPasskey("Phone");
    profiles.addPasskey(session.id, phone);
    const verification = profiles.requestRecoveryEmail(session.id, "learner@example.com");
    profiles.verifyRecoveryEmail(verification.token);
    const recovery = profiles.beginRecovery("learner@example.com");
    const restored = profiles.recover(recovery.token, webauthn.createPasskey("Replacement"));

    expect(restored.profile.id).toBe(anonymous.id);
    expect(restored.profile.passkeys).toHaveLength(3);
    expect(() => profiles.profile(session.id)).toThrow("revoked");
    expect(() => profiles.recover(recovery.token, webauthn.createPasskey())).toThrow("invalid or expired");
  });

  it("expires inactive sessions and requires a recent passkey authentication for sensitive changes", () => {
    const { profiles, webauthn, setTime } = setup();
    const { session } = profiles.createAnonymousProfile();
    profiles.accessHistory(session.id);
    const laptop = webauthn.createPasskey();
    profiles.protect(session.id, laptop);
    setTime("2026-08-27T12:06:00Z");
    expect(() => profiles.requestRecoveryEmail(session.id, "learner@example.com")).toThrow("Recent authentication");
    profiles.authenticate(session.id, laptop);
    profiles.requestRecoveryEmail(session.id, "learner@example.com");
    const renewed = profiles.renewSession(session.id);
    expect(renewed.id).not.toBe(session.id);
    expect(() => profiles.profile(session.id)).toThrow("revoked");
    setTime("2026-09-27T12:06:01Z");
    expect(() => profiles.profile(renewed.id)).toThrow("expired");
  });

  it("rejects expired recovery links", () => {
    const { profiles, webauthn, setTime } = setup();
    const { session } = profiles.createAnonymousProfile();
    profiles.accessHistory(session.id);
    profiles.protect(session.id, webauthn.createPasskey());
    const verification = profiles.requestRecoveryEmail(session.id, "learner@example.com");
    setTime("2026-08-27T12:15:01Z");

    expect(() => profiles.verifyRecoveryEmail(verification.token)).toThrow("invalid or expired");
  });

  it("tombstones deletion immediately, rejects later writes, and exposes the retention schedule", () => {
    const { profiles, webauthn } = setup();
    const { session } = profiles.createAnonymousProfile();
    profiles.accessHistory(session.id);
    profiles.protect(session.id, webauthn.createPasskey());
    const deletion = profiles.deleteProfile(session.id);

    expect(deletion).toMatchObject({ state: "tombstoned" });
    expect(deletion.retention.liveDataPurgeAt).toEqual(new Date("2026-08-28T12:00:00Z"));
    expect(deletion.retention.profileAnalyticsPurgeAt).toEqual(new Date("2026-08-28T12:00:00Z"));
    expect(deletion.retention.backupExpiryAt).toEqual(new Date("2026-09-26T12:00:00Z"));
    expect(() => profiles.recordUse(session.id)).toThrow("revoked");
  });
});
