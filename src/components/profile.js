import { escapeHtml, renderButton } from "./button.js";

const html = String.raw;

export function renderProfile({ profile, deletionConfirmation = false, recoveryVerification, installation, analyticsConsent = false } = {}) {
  if (profile.state === "tombstoned") {
    return html`<section class="region wrapper profile flow" aria-labelledby="profile-title">
      <p class="lesson-label">Profile deleted</p>
      <h1 id="profile-title">Your WordWell profile is scheduled for permanent deletion.</h1>
      <p>Access ended immediately. Live profile data is purged within 24 hours and backups expire within 30 days.</p>
    </section>`;
  }

  if (deletionConfirmation) return renderDeletionConfirmation();

  const protection = profile.state === "anonymous"
    ? renderAnonymousProfile(profile)
    : renderProtectedProfile(profile, recoveryVerification);

  return html`<section class="region wrapper profile flow" aria-labelledby="profile-title">
    <p class="lesson-label">Your WordWell</p>
    <h1 id="profile-title">Keep your learning private and portable.</h1>
    <p>Starting band: Stretch my vocabulary.</p>
    ${protection}
    ${renderInstallation(installation, analyticsConsent)}
  </section>`;
}

function renderInstallation(installation, analyticsConsent) {
  if (!installation || installation.capability === "unavailable" || (installation.capability === "chromium_prompt" && !installation.canPrompt)) return "";
  const install = installation.capability === "ios_home_screen"
    ? "In Safari, choose Share, then Add to Home Screen."
    : renderButton({ label: "Install WordWell", action: "install-app" });
  return html`<section class="profile-section flow">
    <h2>Install WordWell</h2>
    <p>${install}</p>
    <label><input data-action="analytics-consent" type="checkbox" ${analyticsConsent ? "checked" : ""} /> Share anonymous installation signals</label>
    <p>Only install prompt and confirmation events are sent. No device identifier or learning history is collected.</p>
  </section>`;
}

function renderAnonymousProfile(profile) {
  if (!profile.canProtect) {
    return html`<section class="profile-section flow">
      <h2>Anonymous for now</h2>
      <p>Your learning is private in this session. Protection becomes available after three days of use or when you open your history.</p>
    </section>`;
  }
  return html`<section class="profile-section flow">
    <h2>Protect this profile</h2>
    <p>Add a passkey to keep this exact learning history available on another device. WordWell never receives your biometric or device PIN.</p>
    ${renderButton({ label: "Add a passkey", action: "protect-profile" })}
  </section>`;
}

function renderProtectedProfile(profile, recoveryVerification) {
  const passkeys = profile.passkeys.map((passkey) => html`<li class="profile-item"><span>${escapeHtml(passkey.label)}</span>${renderButton({ label: "Remove", action: "revoke-passkey", value: passkey.id, variant: "outline", size: "small" })}</li>`).join("");
  const recovery = profile.recoveryEmail
    ? html`<p><strong>${escapeHtml(profile.recoveryEmail)}</strong> can be used only to regain access when your passkeys are unavailable.</p>`
    : html`<form data-action="add-recovery-email"><label for="recovery-email">Recovery email</label><input id="recovery-email" name="recovery-email" type="email" autocomplete="email" required /><button class="button" type="submit">Send verification link</button></form>`;
  const verification = recoveryVerification
    ? html`<p class="profile-notice" role="status">Verification link prepared for ${escapeHtml(recoveryVerification.email)}. ${renderButton({ label: "Verify recovery email", action: "verify-recovery-email", value: recoveryVerification.token, variant: "outline", size: "small" })}</p>`
    : "";

  return html`<div class="profile-sections flow">
    <section class="profile-section flow">
      <h2>Passkeys</h2>
      <p>Passkeys are your primary way back to this profile.</p>
      <ul class="profile-list" role="list">${passkeys}</ul>
      ${renderButton({ label: "Add another passkey", action: "add-passkey", variant: "outline" })}
    </section>
    <section class="profile-section flow">
      <h2>Recovery email</h2>
      ${recovery}
      ${verification}
    </section>
    <section class="profile-section profile-danger flow">
      <h2>Delete profile</h2>
      <p>Delete your credentials, learning history, and profile-linked analytics permanently.</p>
      ${renderButton({ label: "Delete profile", action: "start-profile-deletion", variant: "outline" })}
    </section>
  </div>`;
}

function renderDeletionConfirmation() {
  return html`<section class="region wrapper profile flow" aria-labelledby="delete-profile-title">
    <p class="lesson-label">Permanent deletion</p>
    <h1 id="delete-profile-title">Delete this WordWell profile?</h1>
    <p>This immediately signs out every session and disables every passkey and recovery email. It cannot be undone.</p>
    <p>Live profile data is purged within 24 hours. Backups expire within 30 days.</p>
    <div class="cluster gap">
      ${renderButton({ label: "Permanently delete profile", action: "confirm-profile-deletion" })}
      ${renderButton({ label: "Keep my profile", action: "cancel-profile-deletion", variant: "outline" })}
    </div>
  </section>`;
}
