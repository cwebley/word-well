// Local private-evaluation setup shared by the CLI and the report: Keychain
// keys from the authoring setup, the private database, and private directories.
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { createPrivateCrypto, keyReferenceSchema } from "../pipeline/storage/crypto.js";
import { readBytes } from "../pipeline/storage/files.js";
import { loadKeychainIdentity } from "../pipeline/storage/keychain.js";
import { createPrivateStore } from "../pipeline/storage/postgres.js";
import { createPlannerRevalidationStore } from "../pipeline/storage/planner-revalidations.js";
import { databaseConnection } from "../db/connections.mjs";

export const checkout = fileURLToPath(new URL("../", import.meta.url));
const privateRoot = resolve(homedir(), "Library/Application Support/WordWell");
export const ledgerDir = resolve(privateRoot, "private-evaluation/ledger");
export const summariesDir = resolve(privateRoot, "private-evaluation/summaries");

export async function openLocalPrivateStore() {
  const keys = z.object({ storageKey: keyReferenceSchema, datasetKey: keyReferenceSchema }).passthrough()
    .parse(JSON.parse((await readBytes(resolve(privateRoot, "private-authoring/keys.json"))).toString()));
  // One Keychain load per key for the whole command.
  const crypto = createPrivateCrypto(loadKeychainIdentity, { cacheIdentities: true });
  const store = await createPrivateStore({
    connectionString: databaseConnection("pipeline"),
    storageKey: keys.storageKey, datasetKey: keys.datasetKey, crypto
  });
  try {
    const revalidations = await createPlannerRevalidationStore({ connectionString: databaseConnection("pipeline"), storageKey: keys.storageKey, crypto });
    const close = async () => { await Promise.all([store.close(), revalidations.close()]); };
    return { store: { ...store, close }, revalidations, crypto, keys: { storageKey: keys.storageKey, datasetKey: keys.datasetKey }, close };
  } catch (error) { await store.close(); throw error; }
}
