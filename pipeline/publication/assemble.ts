import { z } from "zod";
import { fingerprint } from "../config.js";
import { PrivateError } from "../storage/crypto.js";
import { writerInputSchema, checkWrittenLesson, writerResultSchema, normalizeSourceText } from "../stages/writer.js";
import { publishedLessonSchema, type PublishedLesson } from "../../src/lesson-contract.js";

const text = z.string().min(1).refine(value => Boolean(value.trim()));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const locator = z.object({ citationId: text, snapshotId: text, recordId: text }).strict();
export const publicationMaterialSchema = z.object({
  executionKind: z.enum(["live", "controlled"]), candidateId: z.uuid(), lessonId: publishedLessonSchema.shape.lessonId,
  plannerResultId: z.uuid(), writerResultId: z.uuid(),
  plannerFingerprint: hash, writerFingerprint: hash,
  input: writerInputSchema, written: writerResultSchema,
  sources: publishedLessonSchema.shape.sources,
  // These mappings come from pinned source records, not the model's prompt references.
  sourceMeanings: z.record(z.string(), locator),
  citationSnapshots: z.record(z.string(), text),
  familySupport: z.record(z.string(), z.array(z.object({ locator,
    relation: z.object({ source: z.enum(["oewn", "kaikki"]), from: text, to: text, type: text }).strict()
  }).strict()).min(1)),
  pronunciation: z.object({ text, region: z.enum(["US", "General American", "unlabelled", "other"]), support: locator }).strict().nullable(),
  etymology: z.object({ text, rawSha256: hash, support: locator }).strict().nullable(), etymologyAbsence: text.nullable()
}).strict();
export type PublicationMaterial = z.infer<typeof publicationMaterialSchema>;
export const PUBLICATION_CHECKS = "wordwell-publication-checks-v1";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function assembleCandidate(value: PublicationMaterial) {
  const material = publicationMaterialSchema.parse(value), { input } = material;
  const written = checkWrittenLesson(input, material.written);
  const citations = new Map(material.sources.map(source => [source.id, source]));
  if (citations.size !== material.sources.length) throw new PrivateError("publication_citation_duplicate");
  const verify = (support: z.infer<typeof locator>, kind?: "oewn" | "wiktionary") => {
    const citation = citations.get(support.citationId);
    if (!citation || kind && citation.kind !== kind || material.citationSnapshots[support.citationId] !== support.snapshotId)
      throw new PrivateError("publication_support_missing");
  };
  if (!material.sources.some(source => source.kind === "oewn")) throw new PrivateError("publication_attribution_missing");
  for (const source of input.plannerInput.meanings) {
    const support = material.sourceMeanings[source.ref];
    if (!support || support.recordId !== source.sourceId) throw new PrivateError("publication_source_mapping_invalid");
    verify(support, "oewn");
  }
  for (const word of input.plan.word_family) {
    const support = material.familySupport[word];
    if (!support?.length) throw new PrivateError("publication_family_support_missing");
    const selected = input.plannerInput.family.find(family => family.word === word)!;
    for (const value of support) {
      if (!selected.supports.some(relation => fingerprint(relation) === fingerprint(value.relation)) || value.locator.recordId !== value.relation.from)
        throw new PrivateError("publication_family_relation_invalid");
      verify(value.locator, value.relation.source === "oewn" ? "oewn" : "wiktionary");
    }
  }
  if ((material.etymology === null) !== (material.etymologyAbsence !== null)) throw new PrivateError("publication_origin_absence_invalid");
  if (material.pronunciation) verify(material.pronunciation.support);
  if (material.etymology) verify(material.etymology.support, "wiktionary");
  for (const meaning of input.meanings) {
    if (meaning.origin && (!material.etymology || meaning.origin.text !== material.etymology.text || meaning.origin.entryId !== material.etymology.support.recordId || meaning.origin.source_ref !== material.etymology.support.recordId || meaning.origin.rawSha256 !== material.etymology.rawSha256))
      throw new PrivateError("publication_origin_support_invalid");
  }
  const meanings = input.meanings.map((meaning, index) => {
    const plan = input.plan.meanings[index], result = written.meanings.find(result => result.meaning_id === meaning.ref)!;
    return { ref: meaning.ref, definition: plan.definition, partOfSpeech: plan.part_of_speech,
      definingSources: plan.sense_ids.map(ref => material.sourceMeanings[ref]!),
      examples: result.examples, useItWhen: result.situation, doNotUseItFor: result.not_for,
      synonyms: result.synonyms, commonPatterns: result.common_patterns,
      usageNotes: result.usage_notes.map(note => ({ text: note.text, sourceRefs: [material.sourceMeanings[note.source_ref]!.citationId] })),
      originNote: result.origin_note === null ? null : { text: result.origin_note, sourceRefs: [material.etymology!.support.citationId] },
      exampleAssociations: result.examples.map((example, index) => ({ index,
        directMatches: meaning.examples.filter(source => normalizeSourceText(source.text) === normalizeSourceText(example)).map(source => material.sourceMeanings[source.source_ref]),
        adaptationReviewRequired: true })) };
  });
  const publicFields = {
    headword: input.headword, normalizedHeadword: input.headword.normalize("NFKC").toLocaleLowerCase("en").trim(),
    pronunciation: material.pronunciation ? { text: material.pronunciation.text, dialect: material.pronunciation.region, sourceRef: material.pronunciation.support.citationId } : null,
    etymology: material.etymology ? { text: material.etymology.text, sourceRef: material.etymology.support.citationId } : null,
    wordFamily: input.plan.word_family, sources: material.sources,
    license: { name: "CC BY-SA 4.0" as const, url: "https://creativecommons.org/licenses/by-sa/4.0/" as const }
  };
  const blockers = !material.pronunciation ? ["pronunciation_missing"] : material.pronunciation.region === "other" ? ["pronunciation_region_unsupported"] : [];
  const evidenceIdentity = fingerprint({ material, meanings });
  const attributionIdentity = fingerprint(material.sources);
  const body = { schema: "wordwell-publication-candidate-v1" as const, material, publicFields, meanings, blockers,
    checksIdentity: PUBLICATION_CHECKS, evidenceIdentity, attributionIdentity };
  return freeze({ id: fingerprint(body), ...body });
}
export type PublicationCandidate = ReturnType<typeof assembleCandidate>;

export function verifyCandidate(value: PublicationCandidate) {
  const rebuilt = assembleCandidate(value.material);
  if (fingerprint(rebuilt) !== fingerprint(value)) throw new PrivateError("publication_candidate_changed");
  return rebuilt;
}

export function publicProjection(candidate: PublicationCandidate, version: number, meaningIds: string[]): PublishedLesson {
  if (candidate.blockers.length || !candidate.publicFields.pronunciation || meaningIds.length !== candidate.meanings.length)
    throw new PrivateError("publication_candidate_blocked");
  const projected = publishedLessonSchema.safeParse({ ...candidate.publicFields, schemaVersion: "wordwell-lesson-v1",
    lessonId: candidate.material.lessonId, publicationVersion: version,
    meanings: candidate.meanings.map((meaning, index) => ({ ...meaning, id: meaningIds[index] })) });
  if (!projected.success) throw new PrivateError("publication_projection_invalid");
  return projected.data;
}
