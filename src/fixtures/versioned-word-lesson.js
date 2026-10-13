// Harmless consumer fixture. It is not a generated, approved or published lesson.
export const versionedWordLesson = {
  schemaVersion: "wordwell-lesson-v1",
  lessonId: "lesson-candid",
  publicationVersion: 1,
  headword: "candid",
  normalizedHeadword: "candid",
  pronunciation: { text: "/ˈkændɪd/", dialect: "General American", sourceRef: "origin-fixture" },
  etymology: { text: "Synthetic source etymology for consumer checks.", sourceRef: "origin-fixture" },
  wordFamily: ["candor"],
  meanings: [{
    id: "meaning-candid-direct",
    definition: "honest and direct, even when the truth may be uncomfortable",
    partOfSpeech: "adjective",
    examples: [
      "Her candid feedback helped the team improve the proposal.",
      "He was candid about why the plan had not worked.",
      "The memoir is candid about the cost of ambition."
    ],
    useItWhen: "Describing open, direct communication",
    doNotUseItFor: "Describing a statement that conceals the truth",
    synonyms: [
      { synonym: "frank", more: null, less: null },
      { synonym: "blunt", more: "abruptness", less: null }
    ],
    commonPatterns: ["candid feedback", "a candid account"],
    usageNotes: [{ text: "Synthetic usage note for consumer checks.", sourceRefs: ["dictionary-fixture"] }],
    originNote: { text: "Synthetic generated origin note for consumer checks.", sourceRefs: ["origin-fixture"] }
  }],
  sources: [
    {
      id: "dictionary-fixture",
      kind: "oewn",
      name: "Synthetic OEWN consumer fixture",
      release: "controlled-fixture-v1",
      url: "https://example.test/dictionary",
      license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
      credits: ["Synthetic credit placeholder for OEWN and Princeton."],
      notices: ["This fixture is not a dictionary extraction or publication approval."],
      changes: "Synthetic selection and adaptation notice.",
      revisionUrl: null,
      historyUrl: null
    },
    {
      id: "origin-fixture",
      kind: "wiktionary",
      name: "Synthetic Wiktionary consumer fixture",
      release: "controlled-revision-1",
      url: "https://example.test/wiki/candid",
      license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
      credits: ["Synthetic contributor credit placeholder."],
      notices: ["These links demonstrate rendering, not pinned source acquisition."],
      changes: "Synthetic source rendering and additional teaching-text notice.",
      revisionUrl: "https://example.test/wiki/candid?oldid=1",
      historyUrl: "https://example.test/wiki/candid?action=history"
    }
  ],
  license: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" }
};

export const multiMeaningWordLesson = {
  ...versionedWordLesson,
  meanings: [...versionedWordLesson.meanings, {
    ...versionedWordLesson.meanings[0],
    id: "meaning-candid-photo",
    definition: "shown plainly in a photograph without posing or concealment",
    examples: [
      "The newspaper printed a candid photo from the event.",
      "The reporter captured a candid moment backstage.",
      "The exhibition includes candid photographs of the city."
    ],
    useItWhen: "Describing an unposed photograph",
    doNotUseItFor: "Describing a carefully staged portrait",
    synonyms: [{ synonym: "unposed", more: null, less: null }],
    commonPatterns: ["a candid photograph"],
    usageNotes: [], originNote: null
  }]
};

export function syntheticLesson(lessonId, headword, publicationVersion = 1) {
  return { ...structuredClone(versionedWordLesson), lessonId, headword, normalizedHeadword: headword.toLowerCase(), publicationVersion };
}
