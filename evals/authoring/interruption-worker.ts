// Test-only child process. All private fixture material arrives via an anonymous pipe.
import { createPrivateCrypto } from "../../pipeline/storage/crypto.js";
import { createAuthoringStore } from "./store.js";
import { content } from "./fixtures.js";

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  const crypto = createPrivateCrypto(async key => input.identities[key.id]);
  const store = await createAuthoringStore({ ...input.settings, crypto, beforeDraftRename: async () => {
    process.stdout.write("ciphertext_ready\n");
    await new Promise<void>(() => { setInterval(() => {}, 1000); });
  } });
  await store.execute({ action: "save", revision: input.revision, content: content("harmless-interrupted-marker") });
}
main().catch(() => { process.stderr.write("worker_failed\n"); process.exitCode = 1; });
