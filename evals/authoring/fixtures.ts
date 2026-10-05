import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { createPrivateCrypto, type KeyReference } from "../../pipeline/storage/crypto.js";
import { createAuthoringStore } from "./store.js";
import type { CaseContent } from "./records.js";

// Harmless fixtures only. Secrets are generated in memory and never logged.
export async function fixture(options: { beforeDraftRename?: () => Promise<void>; beforeFreezeRename?: () => Promise<void> } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "ww-authoring-test-"));
  const checkout = resolve(root, "checkout");
  const datasetDir = resolve(checkout, "evals/datasets");
  await mkdir(datasetDir, { recursive: true });
  const privateDir = resolve(root, "private");
  const identities = new Map<string, string>();
  const key = async (role: "storage" | "dataset"): Promise<KeyReference> => {
    const identity = await generateIdentity();
    const id = `ww-${role}-v1`; identities.set(id, identity);
    return { id, recipient: await identityToRecipient(identity) };
  };
  const storageKey = await key("storage"); const datasetKey = await key("dataset");
  let keysAvailable = true;
  const crypto = createPrivateCrypto(async reference => {
    if (!keysAvailable || !identities.has(reference.id)) throw new Error("harmless-error-marker-KEY");
    return identities.get(reference.id)!;
  });
  const settings = { privateDir, checkout, datasetDir, workspaceId: randomUUID(), storageKey, datasetKey, crypto, ...options };
  const store = await createAuthoringStore(settings);
  return { root, ...settings, store, identities, setKeysAvailable: (value: boolean) => { keysAvailable = value; },
    reopen: () => createAuthoringStore(settings), cleanup: () => rm(root, { recursive: true, force: true }) };
}

export function content(headword = "exuberant", overrides: Partial<CaseContent> = {}): CaseContent {
  return { headword, finding: "clear", reason: "Harmless stand-in owner choice, not a golden label.", firm: true,
    provenance: "harmless-source-marker-PROVENANCE", variantGroup: randomUUID(), answersInspected: false, ...overrides };
}
