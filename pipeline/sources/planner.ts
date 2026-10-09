import { z } from "zod";
import type { EvidenceBundle } from "./bundle.js";
import { plannerInputSchema, type PlannerInput } from "../stages/planner.js";
import { PrivateError } from "../storage/crypto.js";

const posNames: Record<string, PlannerInput["meanings"][number]["partOfSpeech"]> = { n: "noun", v: "verb", a: "adjective", s: "adjective", r: "adverb" };
export function plannerEvidence(bundleId: string, bundle: EvidenceBundle): PlannerInput {
  const headword = bundle.coverage.candidates[0];
  const entries = bundle.entries.filter(e => e.source === "oewn" && e.role === "candidate" && e.headword === headword);
  const meanings = bundle.meanings.filter(m => m.source === "oewn" && entries.some(e => e.id === m.entryId));
  if (meanings.length !== bundle.coverage.oewnMeanings) throw new PrivateError("planner_inventory_incomplete");
  const family = new Map<string, PlannerInput["family"][number]>();
  for (const r of bundle.relations.filter(r => r.purpose === "family")) {
    const current = family.get(r.word) ?? { word: r.word, supports: [] };
    current.supports.push({ source: r.source, from: r.from, to: r.to, type: r.type });
    family.set(r.word, current);
  }
  return plannerInputSchema.parse({ headword, bundleId, meanings: meanings.map((m, i) => {
    const recordedPos = entries.find(e => e.id === m.entryId)!.pos;
    if (!posNames[recordedPos]) throw new PrivateError("planner_pos_unmapped");
    return { ref: `s${i + 1}`, sourceId: m.id, entryId: m.entryId, conceptId: m.conceptId, order: m.order, recordedPos, partOfSpeech: posNames[recordedPos],
      definition: z.string().parse(m.data.definition), examples: z.array(z.string()).parse(m.data.examples),
      contrasts: bundle.relations.filter(r => r.source === "oewn" && r.purpose === "contrast" && r.from === m.id).map(r => {
        const target = bundle.meanings.find(meaning => meaning.source === "oewn" && meaning.id === r.to);
        const entry = target && bundle.entries.find(e => e.source === "oewn" && e.id === target.entryId && e.headword === r.word);
        const definition = target && z.string().min(1).safeParse(target.data.definition);
        if (!entry || !definition?.success || !definition.data.trim()) throw new PrivateError("planner_contrast_evidence_missing");
        return { word: r.word, type: r.type, definition: definition.data,
          support: { source: r.source, from: r.from, to: r.to, type: r.type } };
      }) };
  }), family: [...family.values()] });
}
