import { createHash } from "node:crypto";
import { Decrypter, Encrypter, identityToRecipient } from "age-encryption";
import { z } from "zod";

export class PrivateError extends Error {
  constructor(public readonly code: string, public readonly references?: { runId: string; ownerRunId?: string }) { super(code); }
}

export const keyIdSchema = z.string().regex(/^ww-(dataset|storage)-v[1-9][0-9]*$/);
export const keyReferenceSchema = z.object({
  id: keyIdSchema,
  recipient: z.string().regex(/^age1[0-9a-z]{58}$/)
}).strict();
export type KeyReference = z.infer<typeof keyReferenceSchema>;
export type LoadIdentity = (key: KeyReference) => Promise<string>;

export function digest(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function verifyIdentity(key: KeyReference, identity: string): Promise<void> {
  try {
    keyReferenceSchema.parse(key);
    if (!/^AGE-SECRET-KEY-1[0-9A-Z]{58}$/.test(identity) ||
        await identityToRecipient(identity) !== key.recipient) throw new Error();
  } catch { throw new PrivateError("key_unavailable"); }
}

const envelopeSchema = z.object({
  schema: z.literal("wordwell-private-record-v1"),
  recordId: z.string(), keyId: keyIdSchema, payload: z.unknown()
}).strict();

// The envelope authenticates the expected record and key, not just the bytes.
export function createPrivateCrypto(loadIdentity: LoadIdentity, options: { cacheIdentities?: boolean } = {}) {
  // Opt-in for high-volume evaluation: each Keychain load spawns a helper
  // (~230 ms) and a run makes many record operations. Only verified identities
  // are kept, in memory, for this process's lifetime; a failure is retried.
  // Authoring keeps re-checking the Keychain on every operation.
  const verified = new Map<string, string>();
  const load = async (key: KeyReference) => {
    const cacheKey = `${key.id}\0${key.recipient}`;
    const cached = verified.get(cacheKey);
    if (cached) return cached;
    try {
      const identity = await loadIdentity(key);
      await verifyIdentity(key, identity);
      if (options.cacheIdentities) verified.set(cacheKey, identity);
      return identity;
    } catch { throw new PrivateError("key_unavailable"); }
  };
  return {
    async verify(key: KeyReference) {
      await load(key);
    },
    async encrypt(key: KeyReference, recordId: string, payload: unknown): Promise<Uint8Array> {
      try {
        await this.verify(key);
        const encrypter = new Encrypter();
        encrypter.addRecipient(key.recipient);
        return await encrypter.encrypt(JSON.stringify({
          schema: "wordwell-private-record-v1", recordId, keyId: key.id, payload
        }));
      } catch (error) {
        if (error instanceof PrivateError) throw error;
        throw new PrivateError("encryption_failed");
      }
    },
    async decrypt<T>(key: KeyReference, recordId: string, bytes: Uint8Array, schema: z.ZodType<T>): Promise<T> {
      const identity = await load(key);
      try {
        const decrypter = new Decrypter();
        decrypter.addIdentity(identity);
        const envelope = envelopeSchema.parse(JSON.parse(await decrypter.decrypt(bytes, "text")));
        if (envelope.recordId !== recordId || envelope.keyId !== key.id) throw new Error();
        return schema.parse(envelope.payload);
      } catch { throw new PrivateError("record_invalid"); }
    }
  };
}
export type PrivateCrypto = ReturnType<typeof createPrivateCrypto>;
