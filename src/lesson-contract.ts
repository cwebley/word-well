import { z } from "zod";

const text = z.string().min(1).refine(value => Boolean(value.trim()));
const id = text.max(200);
const url = z.url({ protocol: /^https$/ });
const sourceRefs = z.array(id).min(1).refine(refs => new Set(refs).size === refs.length);
const sourcedText = z.object({ text, sourceRef: id });
const generatedNote = z.object({ text, sourceRefs });
const source = z.object({
  id,
  kind: z.enum(["oewn", "wiktionary"]),
  name: text,
  release: text,
  url,
  license: z.object({ name: text, url }),
  credits: z.array(text).min(1),
  notices: z.array(text).min(1),
  changes: text,
  revisionUrl: url.nullable(),
  historyUrl: url.nullable()
}).superRefine((value, context) => {
  if (value.kind === "wiktionary" && (!value.revisionUrl || !value.historyUrl))
    context.addIssue({ code: "custom", message: "Wiktionary attribution requires revision and contributor-history links." });
});

// Every object is a public allowlist. Zod strips undeclared fields recursively.
// Internal source mappings and generation records have no place in this contract.
export const publishedLessonSchema = z.object({
  schemaVersion: z.literal("wordwell-lesson-v1"),
  lessonId: id,
  publicationVersion: z.number().int().positive(),
  headword: text,
  normalizedHeadword: text,
  pronunciation: sourcedText.extend({ dialect: text }),
  etymology: sourcedText.nullable(),
  wordFamily: z.array(text).max(4),
  meanings: z.array(z.object({
    id,
    definition: text,
    partOfSpeech: z.enum(["noun", "verb", "adjective", "adverb"]),
    examples: z.array(text).length(3),
    useItWhen: text,
    doNotUseItFor: text,
    synonyms: z.array(z.object({ synonym: text, more: text.nullable(), less: text.nullable() })).max(4),
    commonPatterns: z.array(text.refine(value => !/[\r\n]/u.test(value))).min(1),
    usageNotes: z.array(generatedNote),
    originNote: generatedNote.nullable()
  })).min(1),
  sources: z.array(source).min(1),
  license: z.object({ name: z.literal("CC BY-SA 4.0"), url: z.literal("https://creativecommons.org/licenses/by-sa/4.0/") })
}).superRefine((lesson, context) => {
  const ids = lesson.sources.map(value => value.id), known = new Set(ids);
  if (known.size !== ids.length) context.addIssue({ code: "custom", message: "Source citation IDs must be distinct." });
  if (new Set(lesson.meanings.map(value => value.id)).size !== lesson.meanings.length)
    context.addIssue({ code: "custom", message: "Meaning IDs must be distinct." });
  if (!lesson.etymology && lesson.meanings.some(meaning => meaning.originNote !== null))
    context.addIssue({ code: "custom", message: "Origin notes require supplied source etymology." });
  const refs = [lesson.pronunciation.sourceRef, ...(lesson.etymology ? [lesson.etymology.sourceRef] : []),
    ...lesson.meanings.flatMap(meaning => [...meaning.usageNotes.flatMap(note => note.sourceRefs), ...(meaning.originNote?.sourceRefs ?? [])])];
  if (refs.some(ref => !known.has(ref))) context.addIssue({ code: "custom", message: "Sourced fields must name a public source citation." });
});

export type PublishedLesson = z.infer<typeof publishedLessonSchema>;

export function projectPublishedLesson(value: unknown): PublishedLesson {
  return publishedLessonSchema.parse(value);
}
