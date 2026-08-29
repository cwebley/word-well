export class ProfileClient {
  #adapter;
  #webauthn;
  #cache;

  constructor({ adapter, webauthn }) {
    this.#adapter = adapter;
    this.#webauthn = webauthn;
  }

  get cacheKey() {
    return this.#adapter.cacheKey;
  }

  cache() {
    return this.#cache ? structuredClone(this.#cache) : undefined;
  }

  async load() {
    const response = await this.#adapter.readProfile();
    this.#update(response);
    return response;
  }

  async recordHistoryAccess() {
    const response = await this.#adapter.recordHistoryAccess();
    this.#update(response);
    return response;
  }

  async protect(label) {
    const response = await this.#adapter.registerPasskey(await this.#webauthn.register(await this.#adapter.registrationOptions()), label);
    this.#update(response);
    return response;
  }

  async addPasskey(label) {
    await this.#assertRecentAuthentication();
    const response = await this.#adapter.registerPasskey(await this.#webauthn.register(await this.#adapter.registrationOptions()), label);
    this.#update(response);
    return response;
  }

  async revokePasskey(credentialId) {
    await this.#assertRecentAuthentication();
    const response = await this.#adapter.revokePasskey(credentialId);
    this.#update(response);
    return response;
  }

  async authenticate() {
    const response = await this.#adapter.signIn(await this.#webauthn.authenticate(await this.#adapter.signInOptions()));
    this.#update(response);
    return response;
  }

  async createHandoff() {
    return this.#adapter.createHandoff();
  }

  async redeemHandoff(code) {
    const response = await this.#adapter.redeemHandoff(code);
    this.#update(response);
    return response;
  }

  async requestRecoveryEmail(email) {
    await this.#assertRecentAuthentication();
    return this.#adapter.requestRecoveryEmail(email);
  }

  async verifyRecoveryEmail(token) {
    const response = await this.#adapter.verifyRecoveryEmail(token);
    this.#update(response);
    return response;
  }

  async startRecovery(email) {
    return this.#adapter.startRecovery(email);
  }

  async completeRecovery(token, label) {
    throw new Error(`Passkey recovery is not available until a recovery registration challenge is requested for ${label}.`);
  }

  async deleteProfile() {
    await this.#assertRecentAuthentication();
    const response = await this.#adapter.deleteProfile();
    if (response.status === "tombstoned") this.#cache = undefined;
    return response;
  }

  async #assertRecentAuthentication() {
    const profile = this.#cache;
    if (!profile?.state || profile.state !== "protected") return;
    await this.authenticate();
  }

  #update(response) {
    if (response && "status" in response && "profile" in response && response.profile) {
      this.#cache = response.profile;
    }
  }
}
