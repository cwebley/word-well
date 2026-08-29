export class HttpProfileAdapter {
  #fetch;
  #baseUrl;
  #session;
  #clientContextId;
  #timeZone;

  constructor({
    fetch = (...arguments_) => globalThis.fetch(...arguments_),
    baseUrl = "",
    session = browserSession(),
    clientContextId = browserClientContextId(),
    timeZone = browserTimeZone(),
  } = {}) {
    this.#fetch = fetch;
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#session = session;
    this.#clientContextId = clientContextId;
    this.#timeZone = timeZone;
  }

  get cacheKey() {
    return `profile:${this.#clientContextId}`;
  }

  get hasSession() {
    return Boolean(this.#session.load(this.#clientContextId)?.grant);
  }

  async readProfile() {
    return this.#request("GET", "/profile");
  }

  async createAnonymousProfile() {
    const response = await this.#fetch(`${this.#baseUrl}/profiles/anonymous`, {
      method: "POST",
      headers: { "x-client-context": this.#clientContextId, "x-time-zone": this.#timeZone },
    });
    const value = await response.json();
    if (!response.ok || !value.session?.grant) throw new Error(value.error ?? "Could not create an anonymous profile.");
    this.#session.save(this.#clientContextId, value.session);
    return value;
  }

  async registrationOptions() {
    const response = await this.#request("POST", "/profile/passkey-registration/options");
    if (response.error) throw new Error(response.error);
    return response.options;
  }

  async registerPasskey(response, label) {
    return this.#request("POST", "/profile/passkeys/register", { response, label });
  }

  async signInOptions() {
    const response = await this.#anonymousRequest("POST", "/profile/sign-in/options", {});
    return response.options;
  }

  async signIn(response) {
    const result = await this.#anonymousRequest("POST", "/profile/sign-in", { response });
    if (result.status === "active" && result.session) this.#session.save(this.#clientContextId, result.session);
    return result;
  }

  async createHandoff() {
    return this.#request("POST", "/profile/handoff");
  }

  async redeemHandoff(code) {
    const result = await this.#anonymousRequest("POST", "/profile/handoff/redeem", { code });
    if (result.status === "active" && result.session) this.#session.save(this.#clientContextId, result.session);
    return result;
  }

  async recordHistoryAccess() {
    return this.#request("POST", "/profile/history-accessed");
  }

  async createPasskeyChallenge(purpose, credentialId) {
    const body = { purpose };
    if (credentialId) body.credentialId = credentialId;
    const response = await this.#anonymousRequest("POST", "/profile/passkey-challenge", body);
    if (response.error) throw new Error(response.error);
    return response;
  }

  async protect(credential) {
    return this.#request("POST", "/profile/protect", { credential });
  }

  async addPasskey(credential) {
    return this.#request("POST", "/profile/passkeys", { credential });
  }

  async revokePasskey(credentialId) {
    return this.#request("DELETE", `/profile/passkeys/${encodeURIComponent(credentialId)}`);
  }

  async authenticate(credential) {
    return this.#request("POST", "/profile/authenticate", { credential });
  }

  async requestRecoveryEmail(email) {
    const response = await this.#request("POST", "/profile/recovery-email/request", { email });
    if (response.status === "active" || response.status === "protected") {
      return { status: response.status, profile: response.profile, token: response.token, expiresAt: response.expiresAt };
    }
    return response;
  }

  async verifyRecoveryEmail(token) {
    return this.#anonymousRequest("POST", "/profile/recovery-email/verify", { token });
  }

  async startRecovery(email) {
    const response = await this.#anonymousRequest("POST", "/profile/recover/start", { email });
    if (response.token) return { status: "active", token: response.token, expiresAt: response.expiresAt };
    if (response.error) {
      if (response.status === 404) return { status: "not-found" };
      throw new Error(response.error);
    }
    return response;
  }

  async completeRecovery(token, credential) {
    const response = await this.#anonymousRequest("POST", "/profile/recover/complete", { token, credential });
    if (response.status === "active" && response.session) {
      this.#session.save(this.#clientContextId, response.session);
    }
    return response;
  }

  async deleteProfile() {
    return this.#request("POST", "/profile/delete");
  }

  async #request(method, path, body) {
    const grant = await this.#grant();
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${grant}`,
        "x-time-zone": this.#timeZone,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (value.status === "deleted") this.#session.clear(this.#clientContextId);
    return value;
  }

  async #anonymousRequest(method, path, body) {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method,
      headers: {
        "x-time-zone": this.#timeZone,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (response.ok) return value;
    if (value.status === "deleted" || value.status === "session-expired") return value;
    throw new Error(value.error ?? "Profile request failed.");
  }

  async #grant() {
    const session = this.#session.load(this.#clientContextId);
    if (session?.grant) return session.grant;
    const value = await this.createAnonymousProfile();
    return value.session.grant;
  }
}

function browserSession() {
  const storage = globalThis.sessionStorage;
  const key = (clientId) => `wordwell:session:${clientId}`;
  return {
    load(clientId) {
      const value = storage?.getItem(key(clientId));
      return value ? JSON.parse(value) : undefined;
    },
    save(clientId, session) {
      storage?.setItem(key(clientId), JSON.stringify(session));
    },
    clear(clientId) {
      storage?.removeItem(key(clientId));
    },
  };
}

function browserClientContextId() {
  const key = "wordwell:client-context";
  const stored = globalThis.sessionStorage?.getItem(key);
  if (stored) return stored;
  const clientId = `client-${crypto.randomUUID()}`;
  globalThis.sessionStorage?.setItem(key, clientId);
  return clientId;
}

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}
