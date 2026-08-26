import type { PublishedVocabularyRecord, SourceEvidence } from "../content-pipeline";

export type PublishedMeaning = {
  definition: string;
  example: string;
  useItWhen: string;
  doNotUseItFor: string;
  synonyms: readonly string[];
};

export type PublishedWordLesson = {
  headword: string;
  pronunciation: string;
  meanings: readonly PublishedMeaning[];
};

export const seededWordLesson: PublishedWordLesson = {
  headword: "candid",
  pronunciation: "/ˈkændɪd/",
  meanings: [
    {
      definition: "honest and direct, even when the truth may be uncomfortable",
      example: "Her candid feedback helped the team improve the proposal.",
      useItWhen: "you want to describe open, direct communication",
      doNotUseItFor: "a rude comment that ignores the other person",
      synonyms: ["frank", "open"]
    }
  ]
};

const evidence: SourceEvidence = {
  id: "seeded-candid",
  source: "Open English WordNet",
  sourceId: "eng-01234567-a",
  release: "2025",
  retrievedAt: "2026-08-26",
  license: "CC BY 4.0",
  attribution: "Open English WordNet and Princeton WordNet",
  dialect: "General American",
  originalLabel: "adjective",
  uncertainty: "confirmed",
  claims: ["candid", "/ˈkændɪd/", "adjective", "neutral", seededWordLesson.meanings[0].definition]
};

const meaning = seededWordLesson.meanings[0];

export const seededVocabularyRecord: PublishedVocabularyRecord = {
  headword: seededWordLesson.headword,
  normalizedHeadword: seededWordLesson.headword,
  version: "2026-08-26.1",
  pronunciation: seededWordLesson.pronunciation,
  meanings: [
    {
      ...meaning,
      partOfSpeech: "adjective",
      register: "neutral",
      practice: {
        prompt: "Which sentence uses candid naturally?",
        correctSentence: "Her candid feedback helped the team improve.",
        incorrectSentence: "The candid spreadsheet calculated the totals.",
        explanation: "Feedback can be candid because it can be open and direct."
      },
      provenance: {
        definition: evidence,
        partOfSpeech: evidence,
        register: evidence,
        example: { sourceContext: [evidence] },
        useItWhen: { sourceContext: [evidence] },
        doNotUseItFor: { sourceContext: [evidence] },
        synonyms: { sourceContext: [evidence] },
        practice: { sourceContext: [evidence] }
      }
    }
  ],
  provenance: { headword: evidence, pronunciation: evidence }
};
