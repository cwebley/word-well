import { createSystemOneAdapter } from "./system-one.js";
import { PrivateError } from "../storage/crypto.js";

// Pure classification/accounting remain available; physical dispatch cannot run.
export function createValidationOnlySystemOneAdapter() {
  return createSystemOneAdapter({ apiKey: "validation-only", fetch: async () => { throw new PrivateError("dispatch_forbidden"); } });
}
