import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { plannerInputSchema } from "../../pipeline/stages/planner.js";
import { digest, keyReferenceSchema, PrivateError, type KeyReference, type PrivateCrypto } from "../../pipeline/storage/crypto.js";
import { atomicWrite, privateDirectory, readBytes, syncDirectory, withFileLock } from "../../pipeline/storage/files.js";

export const plannerExpectationSchema = z.object({ requiredDefiningGroups: z.array(z.array(z.string()).min(1)).min(1),
  allowedUsageNoteRefs: z.array(z.string()), allowedOmissionRefs: z.array(z.string()), semanticCriteria: z.array(z.string().min(1)).min(1)
}).strict();
export const plannerCaseSchema = z.object({ id: z.uuid(), input: plannerInputSchema, expectation: plannerExpectationSchema,
  split: z.enum(["development", "held-out"]).optional(),
  approval: z.object({ reviewer: z.literal("local-owner"), approvedAt: z.iso.datetime(), reference: z.string().min(1), answersInspected: z.literal(false) }).strict()
}).strict();
const bodySchema = z.object({ schema: z.literal("wordwell-planner-dataset-v1"), id: z.uuid(), version: z.number().int().positive(), cases: z.array(plannerCaseSchema).min(1).max(10) }).strict();
export const frozenPlannerSchema = bodySchema.extend({ contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const plannerManifestSchema = z.object({ schema: z.literal("wordwell-planner-dataset-manifest-v1"), id: z.uuid(), version: z.number().int().positive(),
  key: keyReferenceSchema, ciphertextSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type FrozenPlannerDataset = z.infer<typeof frozenPlannerSchema>;
export async function loadPlannerDataset(directory: string, crypto: PrivateCrypto) {
  const manifest = plannerManifestSchema.parse(JSON.parse((await readBytes(resolve(directory, "manifest.json"))).toString()));
  const bytes = await readBytes(resolve(directory, "cases.age"));
  if (digest(bytes) !== manifest.ciphertextSha256) throw new PrivateError("ciphertext_mismatch");
  const dataset = await crypto.decrypt(manifest.key, manifest.id, bytes, frozenPlannerSchema);
  const { contentIdentity, ...body } = dataset;
  if (body.id !== manifest.id || body.version !== manifest.version || digest(JSON.stringify(body)) !== contentIdentity) throw new PrivateError("dataset_identity_mismatch");
  return { manifest, dataset };
}
export async function freezePlannerDataset(options: { directory: string; checkout: string; version: number; cases: z.infer<typeof plannerCaseSchema>[]; key: KeyReference; crypto: PrivateCrypto }) {
  if (!options.key.id.startsWith("ww-dataset-")) throw new PrivateError("key_roles_invalid");
  const root = await privateDirectory(options.directory, options.checkout);
  return withFileLock(root, ".freeze-lock", async () => {
    const body = bodySchema.parse({ schema: "wordwell-planner-dataset-v1", id: randomUUID(), version: options.version,
      cases: options.cases.map(c => ({ ...c, split: c.split ?? "development" })) });
    if (new Set(body.cases.map(c => c.id)).size !== body.cases.length || new Set(body.cases.map(c => c.input.headword)).size !== body.cases.length) throw new PrivateError("dataset_membership_invalid");
    for (const c of body.cases) {
      const refs = c.input.meanings.map(m => m.ref);
      const expected = [...c.expectation.requiredDefiningGroups.flat(), ...c.expectation.allowedUsageNoteRefs, ...c.expectation.allowedOmissionRefs];
      if (expected.some(ref => !refs.includes(ref)) || c.expectation.requiredDefiningGroups.flat().some(ref => expected.filter(r => r === ref).length !== 1)) throw new PrivateError("expectation_source_invalid");
    }
    const target = resolve(root, `planner-v${String(body.version).padStart(6, "0")}`);
    try { await lstat(target); throw new PrivateError("version_exists"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const staging = resolve(root, `.${randomUUID()}.tmp`);
    try {
      await mkdir(staging, { mode: 0o700 });
      const dataset = frozenPlannerSchema.parse({ ...body, contentIdentity: digest(JSON.stringify(body)) });
      const bytes = await options.crypto.encrypt(options.key, body.id, dataset);
      const manifest = plannerManifestSchema.parse({ schema: "wordwell-planner-dataset-manifest-v1", id: body.id, version: body.version, key: options.key, ciphertextSha256: digest(bytes) });
      await atomicWrite(resolve(staging, "cases.age"), bytes);
      await atomicWrite(resolve(staging, "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
      await loadPlannerDataset(staging, options.crypto);
      await rename(staging, target); await syncDirectory(root);
      return { directory: target, manifest, contentIdentity: dataset.contentIdentity, cases: dataset.cases.length };
    } finally { await rm(staging, { recursive: true, force: true }); }
  });
}
