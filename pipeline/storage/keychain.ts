import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { keyIdSchema, PrivateError, verifyIdentity, type KeyReference } from "./crypto.js";

const helper = fileURLToPath(new URL("./keychain.swift", import.meta.url));

async function keychain(request: { operation: "get" | "add"; id: string; identity?: string }): Promise<string> {
  if (process.platform !== "darwin" || !keyIdSchema.safeParse(request.id).success)
    throw new PrivateError("key_unavailable");
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/swift", [helper], { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new PrivateError("key_unavailable")); }, 60_000);
    child.stdout.on("data", (data: Buffer) => chunks.push(data));
    child.stdin.on("error", () => {});
    child.on("error", () => { clearTimeout(timer); reject(new PrivateError("key_unavailable")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) reject(new PrivateError("key_unavailable"));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export async function loadKeychainIdentity(key: KeyReference): Promise<string> {
  const identity = await keychain({ operation: "get", id: key.id });
  await verifyIdentity(key, identity);
  return identity;
}

// Explicit setup only. Reuses an existing native identity; never rotates it.
export async function provisionKeychainIdentity(id: string): Promise<KeyReference> {
  keyIdSchema.parse(id);
  let identity: string;
  try { identity = await keychain({ operation: "get", id }); }
  catch {
    identity = await generateIdentity();
    await keychain({ operation: "add", id, identity });
  }
  const key = { id, recipient: await identityToRecipient(identity) };
  await verifyIdentity(key, identity);
  return key;
}
