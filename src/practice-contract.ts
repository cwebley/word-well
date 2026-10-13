import { z } from "zod";
import type { PublishedLesson } from "./lesson-contract.js";

const text = z.string().min(1).refine(value => Boolean(value.trim()));
export const publishedPracticeSchema = z.object({
  schemaVersion: z.literal("wordwell-practice-v1"),
  itemId: text.max(200),
  publicationVersion: z.number().int().positive(),
  lessonId: text.max(200),
  meaningId: text.max(200),
  definition: text,
  partOfSpeech: z.enum(["noun", "verb", "adjective", "adverb"]),
  prompt: text,
  correctSentence: text,
  incorrectSentence: text,
  explanation: text
});
export type PublishedPractice = z.infer<typeof publishedPracticeSchema>;
export const projectPublishedPractice = (value: unknown): PublishedPractice => publishedPracticeSchema.parse(value);

export function retainPracticeRevisions(revisions: Map<string, PublishedPractice>, values: unknown[]): PublishedPractice[] {
  const items = values.map(projectPublishedPractice);
  const pending = new Map<string, PublishedPractice>();
  for (const item of items) {
    const key = `${item.itemId}:${item.publicationVersion}`;
    const previous = pending.get(key) ?? revisions.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(item)) throw new Error("Practice revisions are immutable.");
    pending.set(key, item);
  }
  for (const [key, item] of pending) revisions.set(key, structuredClone(item));
  return items;
}

export function practiceMatchesLesson(item: PublishedPractice, lesson: PublishedLesson): boolean {
  return item.lessonId === lesson.lessonId && lesson.meanings.some(meaning =>
    meaning.id === item.meaningId && meaning.definition === item.definition && meaning.partOfSpeech === item.partOfSpeech);
}
