// @vitest-environment node
import { spawn, spawnSync } from "node:child_process";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPrivateCrypto, verifyIdentity } from "./crypto.js";
import { verifyAgeCli } from "../../evals/private-authoring.js";

const binary = process.env.WORDWELL_AGE_BINARY ?? "age";
const cliAvailable = !spawnSync(binary, ["--version"]).error;
const schema = z.object({ marker: z.string() }).strict();

async function keys() {
  const identity = await generateIdentity();
  const key = { id: "ww-storage-v1", recipient: await identityToRecipient(identity) };
  return { identity, key, crypto: createPrivateCrypto(async () => identity) };
}

async function cli(args: string[], input: Uint8Array, identity?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "ignore", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => reject(new Error("cli_failed")));
    child.on("close", code => code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("cli_failed")));
    child.stdin!.on("error", () => {});
    child.stdin!.end(input);
    const pipe = child.stdio[3];
    if (pipe && "end" in pipe) pipe.end(identity ? identity + "\n" : "");
  });
}

describe("native age private records", () => {
  it("round trips and rejects wrong keys, corruption, truncation, identity and schema mismatches", async () => {
    const { key, crypto } = await keys();
    const payload = { marker: "harmless-crypto-marker" };
    const bytes = await crypto.encrypt(key, "opaque-record", payload);
    expect(await crypto.decrypt(key, "opaque-record", bytes, schema)).toEqual(payload);
    expect(Buffer.from(bytes).includes(Buffer.from(payload.marker))).toBe(false);
    const wrongIdentity = await generateIdentity();
    const wrongKey = { id: key.id, recipient: await identityToRecipient(wrongIdentity) };
    const wrongCrypto = createPrivateCrypto(async () => wrongIdentity);
    await expect(wrongCrypto.decrypt(wrongKey, "opaque-record", bytes, schema)).rejects.toThrow("record_invalid");
    const corrupt = bytes.slice(); corrupt[corrupt.length - 5] ^= 1;
    for (const bad of [corrupt, bytes.slice(0, -1), bytes.slice(0, 100)])
      await expect(crypto.decrypt(key, "opaque-record", bad, schema)).rejects.toThrow("record_invalid");
    await expect(crypto.decrypt(key, "other-record", bytes, schema)).rejects.toThrow("record_invalid");
    await expect(crypto.decrypt({ ...key, id: "ww-storage-v2" }, "opaque-record", bytes, schema)).rejects.toThrow("record_invalid");
    await expect(crypto.decrypt(key, "opaque-record", bytes, z.object({ other: z.string() }).strict())).rejects.toThrow("record_invalid");
    await expect(verifyIdentity(key, wrongIdentity)).rejects.toThrow("key_unavailable");
    const unavailable = createPrivateCrypto(async () => { throw new Error("harmless-private-error-marker"); });
    await expect(unavailable.encrypt(key, "opaque-record", payload)).rejects.toThrow(/^key_unavailable$/);
  });

  it.skipIf(!cliAvailable)("interoperates both directions with pinned age v1.3.2 without key files or key argv", async () => {
    await verifyAgeCli(binary);
    const { identity, key, crypto } = await keys();
    const payload = { marker: "harmless-cli-marker" };
    const bytes = await crypto.encrypt(key, "cli-record", payload);
    const decoded = JSON.parse((await cli(["--decrypt", "--identity", "/dev/fd/3"], bytes, identity)).toString());
    expect(decoded.payload).toEqual(payload);
    const envelope = Buffer.from(JSON.stringify({ schema: "wordwell-private-record-v1", recordId: "cli-record", keyId: key.id, payload }));
    const encrypted = await cli(["--encrypt", "--recipient", key.recipient], envelope);
    expect(await crypto.decrypt(key, "cli-record", encrypted, schema)).toEqual(payload);
  });
});
