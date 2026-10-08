import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";
import { databaseConnection } from "../../db/connections.mjs";
import { createPrivateCrypto, keyReferenceSchema } from "./crypto.js";
import { loadKeychainIdentity } from "./keychain.js";
import { readBytes } from "./files.js";
import { createWriterStore } from "./writer.js";
import { createSourceStore } from "./sources.js";

export async function openLocalWriterStores(evaluation = false) {
  const keys = z.object({ storageKey: keyReferenceSchema, datasetKey: keyReferenceSchema }).passthrough()
    .parse(JSON.parse((await readBytes(resolve(homedir(), "Library/Application Support/WordWell/private-authoring/keys.json"))).toString()));
  const crypto = createPrivateCrypto(loadKeychainIdentity, { cacheIdentities: true });
  const options = { connectionString: databaseConnection("pipeline"), storageKey: keys.storageKey, crypto };
  const store = await createWriterStore({ ...options, ...(evaluation ? { datasetKey: keys.datasetKey } : {}) });
  try {
    const sources = await createSourceStore(options);
    return { store, sources, crypto, keys, close: async () => { await Promise.all([store.close(), sources.close()]); } };
  } catch (error) { await store.close(); throw error; }
}
