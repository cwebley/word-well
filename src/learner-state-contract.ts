import { z } from "zod";
import { publishedLessonSchema } from "./lesson-contract.js";
import { publishedPracticeSchema, practiceMatchesLesson } from "./practice-contract.js";

const text = z.string();
const operationFields = {
  id: text, kind: z.enum(["familiarity", "practice", "active-use", "utility", "content-quality"]),
  deliveryId: text, createdAt: text.optional(), acceptedAt: text.optional(), order: z.coerce.number().optional(),
  familiarity: text.optional(), correct: z.boolean().optional(), activeUse: text.optional(), utility: text.optional(),
  practiceItemId: text.optional(), practiceVersion: z.number().int().positive().optional()
};
export const learnerOperationSchema = z.object(operationFields);
const submission = z.object({
  id: text.min(1), deliveryId: text.min(1),
  createdAt: text.refine(value => !Number.isNaN(Date.parse(value)))
});
export const syncOperationSchema = z.discriminatedUnion("kind", [
  submission.extend({ kind: z.literal("familiarity"), familiarity: z.enum(["Completely new to me", "I think I've heard of it", "Familiar, but I don't use it", "I use it all the time"]) }),
  submission.extend({ kind: z.literal("practice"), correct: z.boolean(), practiceItemId: text.min(1), practiceVersion: z.number().int().positive() }),
  submission.extend({ kind: z.literal("active-use"), activeUse: z.enum(["using", "not_using"]) }),
  submission.extend({ kind: z.literal("utility"), utility: z.enum(["useful", "not_useful"]) }),
  submission.extend({ kind: z.literal("content-quality") })
]);
export type SyncOperation = z.infer<typeof syncOperationSchema>;
const delivery = z.object({
  id: text, lessonId: text, localDate: text, normalizedHeadword: text.optional(),
  status: z.enum(["current", "unavailable"]), familiarity: text.optional(),
  recall: z.object({ stage: text, mastery: z.number(), dueAt: text.optional() }).optional()
});
const lesson = z.object({ id: text, record: publishedLessonSchema }).refine(value => value.id === value.record.lessonId,
  { message: "Stored lesson identity must match its public record." });
export const learnerStateSchema = z.object({
  lessons: z.array(lesson),
  practiceItems: z.array(publishedPracticeSchema),
  history: z.array(delivery), evidence: z.array(learnerOperationSchema), mutable: z.array(learnerOperationSchema),
  delivery: delivery.optional(),
  upcoming: z.array(z.object({ id: text, lessonId: text, normalizedHeadword: text, headword: text.nullable().optional(), startingBand: text.optional() })).optional()
});

export function projectLearnerState(value: unknown) {
  const state = learnerStateSchema.parse(value);
  const available = new Set(state.history.filter(item => item.status === "current").map(item => item.lessonId));
  state.lessons = state.lessons.filter(item => available.has(item.id));
  state.practiceItems = state.practiceItems.filter(item => state.lessons.some(lesson => practiceMatchesLesson(item, lesson.record)));
  return state;
}
