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
