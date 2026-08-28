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
    const credential = this.#createCredential(label, await this.#registerChallenge());
    const response = await this.#adapter.protect(credential);
    this.#update(response);
    return response;
  }

  async addPasskey(label) {
    await this.#assertRecentAuthentication();
    const credential = this.#createCredential(label, await this.#registerChallenge());
    const response = await this.#adapter.addPasskey(credential);
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
    const passkey = this.#cache?.passkeys?.[0];
    if (!passkey) throw new Error("No registered passkey on this profile.");
    const credential = this.#existingCredential(passkey, await this.#authenticateChallenge(passkey.id));
    const response = await this.#adapter.authenticate(credential);
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
    const credential = this.#createCredential(label, "");
    const response = await this.#adapter.completeRecovery(token, credential);
    this.#update(response);
    return response;
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
    const passkey = profile.passkeys?.[0];
    if (!passkey) throw new Error("No registered passkey on this profile.");
    const credential = this.#existingCredential(passkey, await this.#authenticateChallenge(passkey.id));
    await this.#adapter.authenticate(credential);
  }

  #createCredential(label, challenge) {
    return { ...this.#webauthn.createPasskey(label), challenge };
  }

  #existingCredential(passkey, challenge) {
    return { id: passkey.id, challenge };
  }

  async #registerChallenge() {
    const challenge = await this.#adapter.createPasskeyChallenge("register");
    return challenge.challenge;
  }

  async #authenticateChallenge(credentialId) {
    const challenge = await this.#adapter.createPasskeyChallenge("authenticate", credentialId);
    return challenge.challenge;
  }

  #update(response) {
    if (response && "status" in response && "profile" in response && response.profile) {
      this.#cache = response.profile;
    }
  }
}
