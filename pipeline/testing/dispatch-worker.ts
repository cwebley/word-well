// Test-only: a process killed after the dispatch intent is durable and the
// request is in flight. Harmless identities arrive on stdin, never as args.
import { createPrivateCrypto } from "../storage/crypto.js";
import { createPrivateStore } from "../storage/postgres.js";
import { createReceiptLedger } from "../storage/receipts.js";
import { createStageExecutor } from "../execution/executor.js";
import { createSystemOneAdapter } from "../execution/system-one.js";
import { CONFIGURATIONS, createAppropriatenessStage } from "../stages/appropriateness.js";
import { REPO } from "./private-fixtures.js";

// Single-question fixtures: scripted replies answer one question.
const SINGLE_QUESTION = CONFIGURATIONS["v2"];

let text = "";
for await (const chunk of process.stdin) text += chunk;
const job = JSON.parse(text);
const identities = new Map<string, string>(Object.entries(job.identities));
const crypto = createPrivateCrypto(async reference => identities.get(reference.id)!);
const store = await createPrivateStore({ connectionString: job.url, storageKey: job.storageKey, crypto });
const ledger = await createReceiptLedger({ directory: job.ledgerDir, checkout: REPO });
const executor = createStageExecutor({
  store, ledger, settings: job.settings,
  model: createSystemOneAdapter({ apiKey: "harmless-test-key", fetch: async () => {
    process.stdout.write("dispatched\n");
    return new Promise<Response>(() => {});
  } })
});
await executor.execute({ experimentId: job.experimentId, attemptId: job.attemptId,
  stage: createAppropriatenessStage(SINGLE_QUESTION), input: { headword: "exuberant" } });
