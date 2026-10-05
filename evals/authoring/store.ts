import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { digest, keyReferenceSchema, PrivateError, type KeyReference, type PrivateCrypto } from "../../pipeline/storage/crypto.js";
import { atomicWrite, privateDirectory, readBytes, syncDirectory, withFileLock } from "../../pipeline/storage/files.js";
import { approved, caseSchema, contentDigest, firmLabel, inspectionHistorySchema, opaqueId, parseCaseContent, rememberInspection, validateWorkspace, workspaceSchema, type Workspace } from "./records.js";

export const manifestSchema = z.object({
  schema: z.literal("wordwell-private-dataset-manifest-v1"),
  format: z.literal("age-v1-X25519"),
  id: opaqueId,
  version: z.number().int().min(1).max(999999),
  key: keyReferenceSchema,
  ciphertextSha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type DatasetManifest = z.infer<typeof manifestSchema>;
const datasetBodySchema = z.object({
  schema: z.literal("wordwell-appropriateness-dataset-v1"),
  id: opaqueId, version: z.number().int().positive(),
  cases: z.array(caseSchema).min(1).max(1000),
  inspectionHistory: inspectionHistorySchema
}).strict();
const frozenSchema = datasetBodySchema.extend({ contentIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type FrozenDataset = z.infer<typeof frozenSchema>;

export type AuthoringCommand =
  // A firm save records the content-bound approval. An optional split assigns it in the same write.
  // split null ("Not yet") unassigns; undefined keeps the current split.
  | { action: "save"; revision: number; id?: string; content: unknown; split?: "development" | "held-out" | null }
  // Several moves applied in one write; any disallowed move rejects the whole batch.
  | { action: "splits"; revision: number; assignments: { id: string; split: "development" | "held-out" }[] }
  // Refuses while a firm case lacks approval or a split, unless omitUnassigned confirms leaving them out.
  | { action: "freeze"; revision: number; version: number; omitUnassigned?: boolean };

export async function loadFrozenDataset(directory: string, expected: DatasetManifest, crypto: PrivateCrypto): Promise<FrozenDataset> {
  try {
    const manifest = manifestSchema.parse(JSON.parse((await readBytes(resolve(directory, "manifest.json"))).toString()));
    if (JSON.stringify(manifest) !== JSON.stringify(manifestSchema.parse(expected))) throw new PrivateError("dataset_selection_mismatch");
    const bytes = await readBytes(resolve(directory, "cases.age"));
    if (digest(bytes) !== manifest.ciphertextSha256) throw new PrivateError("ciphertext_mismatch");
    const frozen = await crypto.decrypt(manifest.key, manifest.id, bytes, frozenSchema);
    const { contentIdentity, ...body } = frozen;
    if (body.id !== manifest.id || body.version !== manifest.version || digest(JSON.stringify(body)) !== contentIdentity)
      throw new PrivateError("dataset_identity_mismatch");
    const workspace: Workspace = { schema: "wordwell-authoring-v1", id: body.id, revision: 0, cases: body.cases, inspectionHistory: body.inspectionHistory };
    validateWorkspace(workspace);
    if (body.cases.some(row => !approved(row) || !row.split)) throw new PrivateError("dataset_invalid");
    return frozen;
  } catch (error) {
    if (error instanceof PrivateError) throw error;
    throw new PrivateError("dataset_invalid");
  }
}

export async function createAuthoringStore(options: {
  privateDir: string; checkout: string; datasetDir: string; workspaceId: string;
  storageKey: KeyReference; datasetKey: KeyReference; crypto: PrivateCrypto;
  // Internal fault-injection seam. Called after ciphertext fsync, before rename.
  beforeDraftRename?: () => Promise<void>;
  beforeFreezeRename?: () => Promise<void>;
}) {
  opaqueId.parse(options.workspaceId);
  if (!options.storageKey.id.startsWith("ww-storage-") || !options.datasetKey.id.startsWith("ww-dataset-") ||
      options.storageKey.recipient === options.datasetKey.recipient) throw new PrivateError("key_roles_invalid");
  await options.crypto.verify(options.storageKey);
  await options.crypto.verify(options.datasetKey);
  const directory = await privateDirectory(options.privateDir, options.checkout);
  const draftPath = resolve(directory, "workspace.age");
  const load = async (): Promise<Workspace> => {
    try {
      const value = await options.crypto.decrypt(options.storageKey, options.workspaceId, await readBytes(draftPath), workspaceSchema);
      if (value.id !== options.workspaceId) throw new PrivateError("record_invalid");
      validateWorkspace(value);
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { schema: "wordwell-authoring-v1", id: options.workspaceId, revision: 0, cases: [], inspectionHistory: [] };
      if (error instanceof PrivateError) throw error;
      throw new PrivateError("storage_unavailable");
    }
  };
  await load();

  return {
    load,
    async versions(): Promise<number[]> {
      try {
        return (await readdir(options.datasetDir)).filter(name => /^appropriateness-v[0-9]{6}$/.test(name))
          .map(name => Number(name.slice(-6))).sort((a, b) => a - b);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw new PrivateError("storage_unavailable");
      }
    },
    async execute(command: AuthoringCommand): Promise<{ workspace: Workspace; manifest?: DatasetManifest }> {
      return withFileLock(directory, ".write-lock", async () => {
        const workspace = await load();
        if (!Number.isSafeInteger(command.revision) || workspace.revision !== command.revision)
          throw new PrivateError("revision_conflict");
        if (command.action === "freeze") {
          validateWorkspace(workspace);
          const unassigned = workspace.cases.filter(row => firmLabel(row.content) && !(approved(row) && row.split));
          if (unassigned.length && !command.omitUnassigned) throw new PrivateError("firm_cases_unassigned");
          const cases = workspace.cases.filter(row => approved(row) && row.split).sort((a, b) => a.id.localeCompare(b.id));
          if (!cases.length) throw new PrivateError("no_scored_cases");
          if (!Number.isSafeInteger(command.version) || command.version < 1 || command.version > 999999)
            throw new PrivateError("version_invalid");
          const stat = await lstat(options.datasetDir);
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new PrivateError("storage_unavailable");
          return withFileLock(options.datasetDir, ".freeze-lock", async () => {
            const target = resolve(options.datasetDir, `appropriateness-v${String(command.version).padStart(6, "0")}`);
            try { await lstat(target); throw new PrivateError("version_exists"); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
            const id = randomUUID();
            const body = datasetBodySchema.parse({ schema: "wordwell-appropriateness-dataset-v1", id, version: command.version, cases, inspectionHistory: workspace.inspectionHistory });
            const frozen = { ...body, contentIdentity: digest(JSON.stringify(body)) };
            const bytes = await options.crypto.encrypt(options.datasetKey, id, frozen);
            const manifest = manifestSchema.parse({ schema: "wordwell-private-dataset-manifest-v1", format: "age-v1-X25519", id,
              version: command.version, key: options.datasetKey, ciphertextSha256: digest(bytes) });
            const staging = resolve(options.datasetDir, `.${randomUUID()}.tmp`);
            try {
              await mkdir(staging, { mode: 0o700 });
              await atomicWrite(resolve(staging, "cases.age"), bytes);
              await atomicWrite(resolve(staging, "manifest.json"), Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
              await loadFrozenDataset(staging, manifest, options.crypto);
              await options.beforeFreezeRename?.();
              await rename(staging, target);
              await syncDirectory(options.datasetDir);
              return { workspace, manifest };
            } catch (error) {
              if (error instanceof PrivateError) throw error;
              throw new PrivateError("freeze_failed");
            } finally { await rm(staging, { recursive: true, force: true }); }
          });
        }
        if (command.action === "save") {
          const content = parseCaseContent(command.content);
          const existing = command.id ? workspace.cases.find(row => row.id === command.id) : undefined;
          if (command.id && !existing) throw new PrivateError("case_missing");
          if (existing?.content.answersInspected && !content.answersInspected) throw new PrivateError("inspection_cannot_reset");
          rememberInspection(workspace);
          let row = existing;
          if (row) {
            if (contentDigest(row.content) !== contentDigest(content)) {
              row.content = content; row.approval = null; row.split = null; row.assignedAt = null;
            }
          } else {
            row = { id: randomUUID(), content, approval: null, split: null, assignedAt: null };
            workspace.cases.push(row);
          }
          // Saving a firm label is the owner's approval of exactly this content.
          if (firmLabel(row.content) && !approved(row))
            row.approval = { contentDigest: contentDigest(row.content), approvedAt: new Date().toISOString(), reviewer: "local-owner" };
          if (command.split === null) { row.split = null; row.assignedAt = null; }
          else if (command.split) {
            if (!firmLabel(row.content)) throw new PrivateError("firm_label_required");
            // Held-out must be unseen: inspected cases and their variants are refused.
            if (command.split === "held-out" && row.content.answersInspected) throw new PrivateError("heldout_inspected");
            if (row.split !== command.split) { row.split = command.split; row.assignedAt = new Date().toISOString(); }
          }
        } else if (command.action === "splits") {
          const ids = command.assignments.map(item => item.id);
          if (!ids.length || ids.length > 1000 || new Set(ids).size !== ids.length) throw new PrivateError("request_invalid");
          for (const { id, split } of command.assignments) {
            const row = workspace.cases.find(row => row.id === id);
            if (!row) throw new PrivateError("case_missing");
            if (!approved(row)) throw new PrivateError("approval_required");
            if (split !== "development" && split !== "held-out") throw new PrivateError("split_invalid");
            if (split === "held-out" && row.content.answersInspected) throw new PrivateError("heldout_inspected");
            if (row.split !== split) { row.split = split; row.assignedAt = new Date().toISOString(); }
          }
        }
        rememberInspection(workspace);
        workspace.revision++;
        validateWorkspace(workspaceSchema.parse(workspace));
        const bytes = await options.crypto.encrypt(options.storageKey, options.workspaceId, workspace);
        await atomicWrite(draftPath, bytes, options.beforeDraftRename);
        return { workspace };
      });
    }
  };
}
export type AuthoringStore = Awaited<ReturnType<typeof createAuthoringStore>>;
