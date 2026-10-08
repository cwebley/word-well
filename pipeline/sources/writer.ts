import { z } from "zod";
import type { EvidenceBundle } from "./bundle.js";
import { plannerEvidence } from "./planner.js";
import { checkPlan, type LessonPlan, type PlannerInput } from "../stages/planner.js";
import { writerInputSchema, writerMeaningEvidence, writerContrastSourceIds, normalizeSourceText, checkWrittenLesson, type WriterInput, type WrittenLesson } from "../stages/writer.js";
import { fingerprint } from "../config.js";
import { PrivateError } from "../storage/crypto.js";

export function writerEvidence(bundleId: string, bundle: EvidenceBundle, plannerInput: PlannerInput, value: LessonPlan): WriterInput {
  if (fingerprint(plannerEvidence(bundleId, bundle)) !== fingerprint(plannerInput)) throw new PrivateError("writer_source_changed");
  const plan = checkPlan(plannerInput, value);
  if (!plan.meanings.length) throw new PrivateError("planner_not_publishable");
  const entries = bundle.entries.filter(e => e.source === "kaikki" && e.role === "candidate" && e.headword === plannerInput.headword);
  const origins = entries.filter(e => typeof e.data.etymology_text === "string" && e.data.etymology_text.trim());
  const texts = new Set(origins.map(e => z.string().parse(e.data.etymology_text)));
  const originNumbers = new Set(entries.map(e => e.data.etymology_number).filter(n => n !== undefined));
  const unambiguous = texts.size === 1 && originNumbers.size <= 1;
  const excludedQuotations: WriterInput["excludedQuotations"] = [];
  const exampleSchema = z.array(z.object({ type: z.string().optional(), ref: z.string().optional(), text: z.string().optional() }).passthrough());
  for (const meaning of bundle.meanings.filter(m => m.source === "kaikki")) {
    const examples = exampleSchema.parse(meaning.data.examples ?? []);
    for (const example of examples.filter(e => e.type === "quotation" || Boolean(e.ref?.trim()))) {
      if (example.text?.trim()) excludedQuotations.push({ source_ref: meaning.id, text: example.text });
    }
  }
  return writerInputSchema.parse({ headword: plannerInput.headword, bundleId, plannerInput, plan,
    excludedQuotations,
    meanings: plan.meanings.map((m, i) => {
      const entry = unambiguous ? origins.find(e => e.pos === m.part_of_speech || e.pos === "adj" && m.part_of_speech === "adjective" || e.pos === "adv" && m.part_of_speech === "adverb") : undefined;
      const contrastDefinitions = m.synonyms.map(synonym => {
        const ids = writerContrastSourceIds(plannerInput, m, synonym);
        if (!ids.length) throw new PrivateError("writer_contrast_evidence_missing");
        return { synonym, definitions: ids.map(sourceId => {
          const meaning = bundle.meanings.find(s => s.source === "oewn" && s.id === sourceId);
          const sourceEntry = meaning && bundle.entries.find(e => e.source === "oewn" && e.id === meaning.entryId && e.headword === synonym);
          const definition = meaning && z.string().min(1).safeParse(meaning.data.definition);
          if (!sourceEntry || !definition?.success || !definition.data.trim()) throw new PrivateError("writer_contrast_evidence_missing");
          return { sourceId, definition: definition.data };
        }) };
      });
      return { ref: `m${i + 1}`, definition: m.definition, partOfSpeech: m.part_of_speech, synonyms: m.synonyms,
        contrastDefinitions,
        ...writerMeaningEvidence(plannerInput, m),
        origin: entry ? { source_ref: entry.id, entryId: entry.id, rawSha256: entry.rawSha256, text: entry.data.etymology_text } : null,
        originAbsence: entry ? null : !origins.length ? "No usable origin text in the verified scoped entries." : !unambiguous ? "Multiple origins lack an unambiguous planned-meaning mapping." : "No origin evidence for this part of speech." };
    }) });
}
export function assembleWrittenLesson(input: WriterInput, value: WrittenLesson) {
  const lesson = checkWrittenLesson(input, value);
  return { headword: input.headword, word_family: input.plan.word_family, meanings: input.meanings.map((m, i) => {
    const written = lesson.meanings.find(w => w.meaning_id === m.ref)!;
    return { ...written, definition: input.plan.meanings[i].definition, part_of_speech: input.plan.meanings[i].part_of_speech,
      defining_source_refs: input.plan.meanings[i].sense_ids,
      exampleAssociations: written.examples.map((example, index) => ({ index, directMatches: m.examples.filter(e => normalizeSourceText(e.text) === normalizeSourceText(example)).map(e => e.source_ref),
        adaptationReviewRequired: true })), originSupport: written.origin_note === null ? null : m.origin };
  }) };
}
