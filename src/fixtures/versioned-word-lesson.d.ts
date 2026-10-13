import type { PublishedLesson } from "../lesson-contract.js";

export const versionedWordLesson: PublishedLesson;
export const multiMeaningWordLesson: PublishedLesson;
export function syntheticLesson(lessonId: string, headword: string, publicationVersion?: number): PublishedLesson;
