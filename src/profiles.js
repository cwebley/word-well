const sessionLifetime = 30 * 24 * 60 * 60 * 1000;
const recentAuthenticationLifetime = 5 * 60 * 1000;
const recoveryLifetime = 15 * 60 * 1000;

export class Profiles {
  #profiles = new Map();
  #sessions = new Map();
  #recoveryLinks = new Map();
  #webauthn;
  #now;
  #nextProfile = 1;
  #nextSession = 1;
  #nextRecovery = 1;

  constructor({ webauthn, now = () => new Date() }) {
    this.#webauthn = webauthn;
    this.#now = now;
  }

  createAnonymousProfile() {
    const profile = {
      id: `profile-${this.#nextProfile++}`,
      state: "anonymous",
      activityDays: new Set(),
      historyAccessed: false,
      passkeys: new Map(),
      recoveryEmail: undefined,
      deletedAt: undefined,
      retention: undefined,
      lastActiveAt: this.#time(),
    };
    this.#profiles.set(profile.id, profile);
    return { profile: this.#publicProfile(profile), session: this.#createSession(profile.id, true) };
  }

  recordUse(sessionId, date = this.#time()) {
    const { profile } = this.#access(sessionId);
    profile.activityDays.add(date.toISOString().slice(0, 10));
    profile.lastActiveAt = date;
    return this.#publicProfile(profile);
  }

  accessHistory(sessionId) {
    const { profile } = this.#access(sessionId);
    profile.historyAccessed = true;
    profile.lastActiveAt = this.#time();
    return this.#publicProfile(profile);
  }

  profile(sessionId) {
    const { profile } = this.#access(sessionId);
    return this.#publicProfile(profile);
  }

  protect(sessionId, credential) {
    const { profile, session } = this.#access(sessionId);
    if (profile.state !== "anonymous") throw new Error("Profile is already protected.");
    if (!this.#canProtect(profile)) throw new Error("Protection is not available yet.");
    this.#registerPasskey(profile, credential);
    profile.state = "protected";
    session.authenticatedAt = this.#time();
    return this.#publicProfile(profile);
  }

  addPasskey(sessionId, credential) {
    const { profile } = this.#access(sessionId, { recentAuthentication: true });
    this.#requireProtected(profile);
    this.#registerPasskey(profile, credential);
    return this.#publicProfile(profile);
  }

  revokePasskey(sessionId, credentialId) {
    const { profile } = this.#access(sessionId, { recentAuthentication: true });
    this.#requireProtected(profile);
    if (!profile.passkeys.has(credentialId)) throw new Error("Passkey was not found.");
    if (profile.passkeys.size === 1) throw new Error("Register another passkey before removing the last one.");
    profile.passkeys.delete(credentialId);
    return this.#publicProfile(profile);
  }

  requestRecoveryEmail(sessionId, email) {
    const { profile } = this.#access(sessionId, { recentAuthentication: true });
    this.#requireProtected(profile);
    if (!email) throw new Error("Enter a recovery email.");
    const token = `verify-${this.#nextRecovery++}`;
    this.#recoveryLinks.set(token, { profileId: profile.id, email, expiresAt: this.#time() + recoveryLifetime, used: false, purpose: "verify" });
    return { token, expiresAt: new Date(this.#recoveryLinks.get(token).expiresAt) };
  }

  verifyRecoveryEmail(token) {
    const link = this.#consumeLink(token, "verify");
    const profile = this.#activeProfile(link.profileId);
    profile.recoveryEmail = link.email;
    return this.#publicProfile(profile);
  }

  beginRecovery(email) {
    const profile = [...this.#profiles.values()].find((candidate) => candidate.state === "protected" && candidate.recoveryEmail === email);
    if (!profile) return undefined;
    const token = `recover-${this.#nextRecovery++}`;
    this.#recoveryLinks.set(token, { profileId: profile.id, expiresAt: this.#time() + recoveryLifetime, used: false, purpose: "recover" });
    return { token, expiresAt: new Date(this.#recoveryLinks.get(token).expiresAt) };
  }

  recover(token, credential) {
    const link = this.#consumeLink(token, "recover");
    const profile = this.#activeProfile(link.profileId);
    this.#registerPasskey(profile, credential);
    this.#revokeProfileSessions(profile.id);
    return { profile: this.#publicProfile(profile), session: this.#createSession(profile.id, true) };
  }

  authenticate(sessionId, credential) {
    const { profile, session } = this.#access(sessionId);
    this.#requireProtected(profile);
    if (!profile.passkeys.has(credential?.id) || !this.#webauthn.verify(credential)) throw new Error("Passkey verification failed.");
    session.authenticatedAt = this.#time();
    return this.#publicProfile(profile);
  }

  renewSession(sessionId) {
    const { session } = this.#access(sessionId);
    session.revoked = true;
    return this.#createSession(session.profileId, session.authenticatedAt + recentAuthenticationLifetime > this.#time());
  }

  deleteProfile(sessionId) {
    const { profile } = this.#access(sessionId, { recentAuthentication: true });
    return this.#tombstone(profile);
  }

  expireInactiveProfiles() {
    const cutoff = this.#time() - 365 * 24 * 60 * 60 * 1000;
    for (const profile of this.#profiles.values()) {
      if (profile.state !== "tombstoned" && profile.lastActiveAt < cutoff) {
        this.#tombstone(profile);
      }
    }
  }

  #access(sessionId, { recentAuthentication = false } = {}) {
    const session = this.#sessions.get(sessionId);
    if (!session || session.revoked || session.expiresAt <= this.#time()) throw new Error("Session has expired or been revoked.");
    const profile = this.#activeProfile(session.profileId);
    if (recentAuthentication && session.authenticatedAt + recentAuthenticationLifetime <= this.#time()) throw new Error("Recent authentication is required.");
    session.lastContactAt = this.#time();
    session.expiresAt = this.#time() + sessionLifetime;
    return { profile, session };
  }

  #activeProfile(profileId) {
    const profile = this.#profiles.get(profileId);
    if (!profile || profile.state === "tombstoned") throw new Error("Profile has been deleted.");
    return profile;
  }

  #createSession(profileId, authenticated) {
    const now = this.#time();
    const session = { id: `session-${this.#nextSession++}`, profileId, authenticatedAt: authenticated ? now : undefined, lastContactAt: now, expiresAt: now + sessionLifetime, revoked: false };
    this.#sessions.set(session.id, session);
    return { id: session.id, expiresAt: new Date(session.expiresAt) };
  }

  #registerPasskey(profile, credential) {
    if (!this.#webauthn.verify(credential)) throw new Error("Passkey registration failed.");
    profile.passkeys.set(credential.id, { id: credential.id, label: credential.label });
  }

  #revokeProfileSessions(profileId) {
    for (const session of this.#sessions.values()) if (session.profileId === profileId) session.revoked = true;
  }

  #tombstone(profile) {
    const deletedAt = this.#time();
    profile.state = "tombstoned";
    profile.deletedAt = deletedAt;
    profile.passkeys.clear();
    profile.recoveryEmail = undefined;
    profile.retention = {
      liveDataPurgeAt: new Date(deletedAt + 24 * 60 * 60 * 1000),
      profileAnalyticsPurgeAt: new Date(deletedAt + 24 * 60 * 60 * 1000),
      backupExpiryAt: new Date(deletedAt + 30 * 24 * 60 * 60 * 1000),
      securityRecordExpiryAt: new Date(deletedAt + 30 * 24 * 60 * 60 * 1000),
      requestIpLogExpiryAt: new Date(deletedAt + 7 * 24 * 60 * 60 * 1000),
    };
    this.#revokeProfileSessions(profile.id);
    return { state: profile.state, deletedAt, retention: profile.retention };
  }

  #consumeLink(token, purpose) {
    const link = this.#recoveryLinks.get(token);
    if (!link || link.purpose !== purpose || link.used || link.expiresAt <= this.#time()) throw new Error("Recovery link is invalid or expired.");
    link.used = true;
    return link;
  }

  #canProtect(profile) {
    return profile.activityDays.size >= 3 || profile.historyAccessed;
  }

  #requireProtected(profile) {
    if (profile.state !== "protected") throw new Error("Profile protection is required.");
  }

  #publicProfile(profile) {
    return {
      id: profile.id,
      state: profile.state,
      canProtect: this.#canProtect(profile),
      passkeys: [...profile.passkeys.values()],
      recoveryEmail: profile.recoveryEmail,
    };
  }

  #time() {
    return this.#now().getTime();
  }
}
