export class WebAuthnSimulator {
  #credentials = new Map();
  #nextId = 1;

  createPasskey(label = "This device") {
    const credential = {
      id: `passkey-${this.#nextId++}`,
      label,
      publicKey: randomPublicKey(),
    };
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

function randomPublicKey() {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
