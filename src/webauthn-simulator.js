export class WebAuthnSimulator {
  #credentials = new Map();
  #nextId = 1;

  createPasskey(label = "This device") {
    const credential = { id: `passkey-${this.#nextId++}`, label };
    this.#credentials.set(credential.id, credential);
    return credential;
  }

  verify(credential) {
    return Boolean(credential && this.#credentials.has(credential.id));
  }

  getPasskey(id) {
    return this.#credentials.get(id);
  }
}
