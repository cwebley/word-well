import { versionedWordLesson } from "./versioned-word-lesson.js";

// Synthetic consumer item, independent of the synthetic lesson body.
export const versionedPractice = {
  schemaVersion: "wordwell-practice-v1",
  itemId: "practice-candid-direct",
  publicationVersion: 1,
  lessonId: versionedWordLesson.lessonId,
  meaningId: versionedWordLesson.meanings[0].id,
  definition: versionedWordLesson.meanings[0].definition,
  partOfSpeech: versionedWordLesson.meanings[0].partOfSpeech,
  prompt: "Which sentence uses candid naturally?",
  correctSentence: "Her candid answer clarified the problem.",
  incorrectSentence: "The candid chair held four people.",
  explanation: "Candid describes direct honesty."
};
