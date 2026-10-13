import { randomUUID } from "node:crypto";
import { fingerprint } from "../config.js";
import type { PublicationCandidate } from "./assemble.js";

export type MeaningRevision = {
  id: string; definition: string; partOfSpeech: string;
  definingSources: PublicationCandidate["meanings"][number]["definingSources"];
  predecessors: string[];
};
const sourceKey = (source: MeaningRevision["definingSources"][number]) => fingerprint({ snapshotId: source.snapshotId, recordId: source.recordId });
const groupKey = (meaning: Pick<MeaningRevision, "partOfSpeech" | "definingSources">) => fingerprint({
  partOfSpeech: meaning.partOfSpeech, sources: meaning.definingSources.map(sourceKey).sort()
});

// Snapshot identity is part of the key. Equal ID strings from different releases
// are not correspondence. A verified cross-release mapping is later work.
export function resolveMeanings(candidate: PublicationCandidate, previous: MeaningRevision[], newId = randomUUID): MeaningRevision[] {
  return candidate.meanings.map(meaning => {
    const exact = previous.find(old => groupKey(old) === groupKey(meaning));
    const sources = new Set(meaning.definingSources.map(sourceKey));
    const predecessors = exact ? exact.predecessors : previous.filter(old => old.definingSources.some(source => sources.has(sourceKey(source)))).map(old => old.id);
    return { id: exact?.id ?? newId(), definition: meaning.definition, partOfSpeech: meaning.partOfSpeech,
      definingSources: meaning.definingSources, predecessors };
  });
}
