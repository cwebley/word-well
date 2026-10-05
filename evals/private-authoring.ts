import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { createPrivateCrypto, keyReferenceSchema, PrivateError } from "../pipeline/storage/crypto.js";
import { loadKeychainIdentity, provisionKeychainIdentity } from "../pipeline/storage/keychain.js";
import { atomicWrite, privateDirectory, readBytes, recoverStoppedLock, withFileLock } from "../pipeline/storage/files.js";
import { createAuthoringStore } from "./authoring/store.js";
import { startAuthoringServer } from "./authoring/server.js";

const checkout = fileURLToPath(new URL("../", import.meta.url));
export const AGE_CLI_VERSION = "v1.3.2";
const configSchema = z.object({
  schema: z.literal("wordwell-authoring-local-config-v1"),
  workspaceId: z.uuid(), storageKey: keyReferenceSchema, datasetKey: keyReferenceSchema
}).strict();

export async function verifyAgeCli(binary = "age"): Promise<void> {
  try {
    const { stdout } = await promisify(execFile)(binary, ["--version"], { timeout: 10_000 });
    if (stdout.trim() !== AGE_CLI_VERSION) throw new Error();
  } catch { throw new PrivateError("age_cli_version_required"); }
}

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2);
  const operation = args.shift();
  if (!["setup", "start", "recover"].includes(operation ?? "")) throw new PrivateError("use_setup_start_or_recover");
  let privateDir = resolve(homedir(), "Library/Application Support/WordWell/private-authoring");
  let port = 0;
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === "--private-dir" && args[i + 1]) privateDir = resolve(args[i + 1]);
    else if (args[i] === "--port" && args[i + 1]) port = Number(args[i + 1]);
    else throw new PrivateError("arguments_invalid");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new PrivateError("arguments_invalid");
  await verifyAgeCli();
  const directory = await privateDirectory(privateDir, checkout);
  if (operation === "recover") {
    // No case decryption or mutations. Orphan ciphertext remains ignored.
    await recoverStoppedLock(directory, ".setup-lock");
    await recoverStoppedLock(directory, ".write-lock");
    await recoverStoppedLock(resolve(checkout, "evals/datasets"), ".freeze-lock");
    console.log("Stopped-owner locks recovered. Encrypted artifacts unchanged.");
    return;
  }
  const configPath = resolve(directory, "keys.json");
  const crypto = createPrivateCrypto(loadKeychainIdentity);
  if (operation === "setup") {
    await withFileLock(directory, ".setup-lock", async () => {
      try {
        const existing = configSchema.parse(JSON.parse((await readBytes(configPath)).toString()));
        await crypto.verify(existing.storageKey); await crypto.verify(existing.datasetKey);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PrivateError("setup_failed");
        const storageKey = await provisionKeychainIdentity("ww-storage-v1");
        const datasetKey = await provisionKeychainIdentity("ww-dataset-v1");
        await crypto.verify(storageKey); await crypto.verify(datasetKey);
        const config = configSchema.parse({ schema: "wordwell-authoring-local-config-v1", workspaceId: randomUUID(), storageKey, datasetKey });
        await atomicWrite(configPath, Buffer.from(JSON.stringify(config, null, 2) + "\n"));
      }
    });
    console.log("Local Keychain identities verified. Setup complete.");
    return;
  }
  let config;
  try { config = configSchema.parse(JSON.parse((await readBytes(configPath)).toString())); }
  catch { throw new PrivateError("setup_required"); }
  const store = await createAuthoringStore({ privateDir: directory, checkout, datasetDir: resolve(checkout, "evals/datasets"),
    workspaceId: config.workspaceId, storageKey: config.storageKey, datasetKey: config.datasetKey, crypto });
  const server = await startAuthoringServer(store, port);
  console.log(`Open this local session in your browser: ${server.url}`);
  console.log("Stop with Ctrl-C. No model client is loaded.");
  const stop = () => { void server.close().then(() => process.exit(0)); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error instanceof PrivateError ? error.code : "authoring_failed");
    process.exitCode = 1;
  });
}
