// Test-only: freezes harmless cases through the real authoring store.
import { resolve } from "node:path";
import { content, fixture } from "./authoring/fixtures.js";
import type { CaseContent } from "./authoring/records.js";

export async function frozenDataset(cases: { headword: string; finding: "clear" | "blocked"; overrides?: Partial<CaseContent>; split?: "development" | "held-out" }[]) {
  const f = await fixture();
  for (const c of cases) {
    let { workspace } = await f.store.execute({ action: "save", revision: (await f.store.load()).revision,
      content: content(c.headword, { finding: c.finding, reason: `harmless-reason-marker-${c.finding}`, ...c.overrides }) });
    const id = workspace.cases.at(-1)!.id;
    await f.store.execute({ action: "splits", revision: workspace.revision, assignments: [{ id, split: c.split ?? "development" }] });
  }
  const { manifest } = await f.store.execute({ action: "freeze", revision: (await f.store.load()).revision, version: 1 });
  // Trials run case by case in frozen case-ID order.
  const order = (await f.store.load()).cases.sort((a, b) => a.id.localeCompare(b.id)).map(c => c.content.headword);
  return { f, manifest: manifest!, datasetDir: resolve(f.datasetDir, "appropriateness-v000001"), order };
}
