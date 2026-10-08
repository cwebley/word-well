import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { writerInputSchema } from "../../pipeline/stages/writer.js";
import { digest, keyReferenceSchema, PrivateError, type KeyReference, type PrivateCrypto } from "../../pipeline/storage/crypto.js";
import { atomicWrite, privateDirectory, readBytes, syncDirectory, withFileLock } from "../../pipeline/storage/files.js";

export const writerExpectationSchema = z.object({ semanticCriteria: z.array(z.string().min(1)).min(1) }).strict();
export const writerCaseSchema = z.object({ id: z.uuid(), input: writerInputSchema, expectation: writerExpectationSchema,
  split: z.enum(["development", "held-out"]),
  approval: z.object({ reviewer: z.literal("local-owner"), approvedAt: z.iso.datetime(), reference: z.string().min(1),
    fixedPlanApproved: z.literal(true), answersInspected: z.literal(false) }).strict()
}).strict();
const bodySchema = z.object({ schema: z.literal("wordwell-writer-dataset-v1"), id: z.uuid(), version: z.number().int().positive(), cases: z.array(writerCaseSchema).min(1).max(10) }).strict();
export const frozenWriterSchema = bodySchema.extend({ contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const writerManifestSchema = z.object({ schema: z.literal("wordwell-writer-dataset-manifest-v1"), id: z.uuid(), version: z.number().int().positive(),
  key: keyReferenceSchema, ciphertextSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type FrozenWriterDataset = z.infer<typeof frozenWriterSchema>;
export async function loadWriterDataset(directory: string, crypto: PrivateCrypto) {
  const manifest = writerManifestSchema.parse(JSON.parse((await readBytes(resolve(directory, "manifest.json"))).toString()));
  const bytes = await readBytes(resolve(directory, "cases.age"));
  if (digest(bytes) !== manifest.ciphertextSha256) throw new PrivateError("ciphertext_mismatch");
  const dataset = await crypto.decrypt(manifest.key, manifest.id, bytes, frozenWriterSchema);
  const { contentIdentity, ...body } = dataset;
  if (body.id !== manifest.id || body.version !== manifest.version || digest(JSON.stringify(body)) !== contentIdentity) throw new PrivateError("dataset_identity_mismatch");
  checkMembership(dataset);
  return { manifest, dataset };
}
function checkMembership(dataset: FrozenWriterDataset) {
  if (new Set(dataset.cases.map(c => c.id)).size !== dataset.cases.length || new Set(dataset.cases.map(c => c.input.headword)).size !== dataset.cases.length)
    throw new PrivateError("dataset_membership_invalid");
}
export async function freezeWriterDataset(options: { directory: string; checkout: string; version: number; cases: z.infer<typeof writerCaseSchema>[]; key: KeyReference; crypto: PrivateCrypto }) {
  if (!options.key.id.startsWith("ww-dataset-")) throw new PrivateError("key_roles_invalid");
  const root = await privateDirectory(options.directory, options.checkout);
  return withFileLock(root, ".freeze-lock", async () => {
    const body = bodySchema.parse({ schema: "wordwell-writer-dataset-v1", id: randomUUID(), version: options.version, cases: options.cases });
    const dataset = frozenWriterSchema.parse({ ...body, contentIdentity: digest(JSON.stringify(body)) });
    checkMembership(dataset);
    const target = resolve(root, `writer-v${String(body.version).padStart(6, "0")}`);
    try { await lstat(target); throw new PrivateError("version_exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const staging = resolve(root, `.${randomUUID()}.tmp`);
    try {
      await mkdir(staging, { mode: 0o700 });
      const bytes = await options.crypto.encrypt(options.key, body.id, dataset);
      const manifest = writerManifestSchema.parse({ schema: "wordwell-writer-dataset-manifest-v1", id: body.id, version: body.version, key: options.key, ciphertextSha256: digest(bytes) });
      await atomicWrite(resolve(staging, "cases.age"), bytes);
      await atomicWrite(resolve(staging, "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
      await loadWriterDataset(staging, options.crypto);
      await rename(staging, target); await syncDirectory(root);
      return { directory: target, manifest, contentIdentity: dataset.contentIdentity, cases: dataset.cases.length };
    } finally { await rm(staging, { recursive: true, force: true }); }
  });
}
