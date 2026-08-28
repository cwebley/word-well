export const seededVocabularyRecord = {
  headword: "candid",
  normalizedHeadword: "candid",
  version: "2026-08-26.1",
  pronunciation: "/ˈkændɪd/",
  etymology: "Candid comes from Latin candidus, meaning white, bright, or shining. Public figures seeking office wore white togas, which helped the word acquire its modern sense of openness.",
  meanings: [
    {
      definition: "honest and direct, even when the truth may be uncomfortable",
      examples: [
        "Her candid feedback helped the team improve the proposal.",
        "He was candid about why the plan had not worked.",
        "The memoir is candid about the cost of ambition."
      ],
      useItWhen: "you want to describe open, direct communication",
      doNotUseItFor: "a rude comment that ignores the other person",
      synonyms: ["frank", "open"],
      partOfSpeech: "adjective",
      register: "neutral",
      practice: {
        prompt: "Which sentence uses candid naturally?",
        correctSentence: "Her candid feedback helped the team improve.",
        incorrectSentence: "The candid spreadsheet calculated the totals.",
        explanation: "Feedback can be candid because it can be open and direct."
      }
    }
  ]
};

export const multiMeaningVocabularyRecord = {
  ...seededVocabularyRecord,
  meanings: [
    ...seededVocabularyRecord.meanings,
    {
      definition: "shown plainly in a photograph without posing or concealment",
      examples: [
        "The newspaper printed a candid photo from the event.",
        "The reporter captured a candid moment backstage.",
        "The exhibition includes candid photographs of the city."
      ],
      useItWhen: "you mean an unposed or informal photograph",
      doNotUseItFor: "a carefully staged portrait",
      synonyms: ["unposed", "informal"],
      partOfSpeech: "adjective",
      register: "neutral",
      practice: {
        prompt: "Which sentence uses candid naturally?",
        correctSentence: "The reporter captured a candid moment backstage.",
        incorrectSentence: "The candid engine needed more oil.",
        explanation: "A photograph or moment can be candid when it is unposed."
      }
    }
  ]
};
