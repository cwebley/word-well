import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export class BrowserWebAuthn {
  register(options) {
    return startRegistration({ optionsJSON: options });
  }

  authenticate(options) {
    return startAuthentication({ optionsJSON: options });
  }
}
