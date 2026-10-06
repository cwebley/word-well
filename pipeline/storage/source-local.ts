import { homedir } from "node:os";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { databaseConnection } from "../../db/connections.mjs";
import { createPrivateCrypto, keyReferenceSchema } from "./crypto.js";
import { loadKeychainIdentity } from "./keychain.js";
import { createSourceStore } from "./sources.js";

export async function openLocalSourceStore() {
  const { storageKey } = z.object({ storageKey: keyReferenceSchema }).passthrough().parse(JSON.parse(await readFile(resolve(homedir(), "Library/Application Support/WordWell/private-authoring/keys.json"), "utf8")));
  return createSourceStore({ connectionString: databaseConnection("pipeline"), storageKey,
    crypto: createPrivateCrypto(loadKeychainIdentity, { cacheIdentities: true }) });
}
