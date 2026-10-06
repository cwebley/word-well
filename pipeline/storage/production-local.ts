import { homedir } from "node:os";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { databaseConnection } from "../../db/connections.mjs";
import { createPrivateCrypto, keyReferenceSchema } from "./crypto.js";
import { loadKeychainIdentity } from "./keychain.js";
import { createPrivateStore } from "./postgres.js";
import { createSourceStore } from "./sources.js";

export const productionLedgerDirectory = resolve(homedir(), "Library/Application Support/WordWell/production/ledger");
export async function openLocalProductionStores() {
  // Production has no dataset identity and cannot read owner labels.
  const { storageKey } = z.object({ storageKey: keyReferenceSchema }).passthrough().parse(JSON.parse(await readFile(resolve(homedir(), "Library/Application Support/WordWell/private-authoring/keys.json"), "utf8")));
  const options = { connectionString: databaseConnection("pipeline"), storageKey, crypto: createPrivateCrypto(loadKeychainIdentity, { cacheIdentities: true }) };
  const store = await createPrivateStore(options);
  try {
    const sources = await createSourceStore(options);
    return { store, sources, close: async () => { await Promise.all([store.close(), sources.close()]); } };
  } catch (error) { await store.close(); throw error; }
}
