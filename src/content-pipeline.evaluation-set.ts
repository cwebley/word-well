import type { EvaluationSet } from "./content-pipeline";

const evidence = [
  {
    id: "oewn-candid-adjective",
    source: "Open English WordNet",
    sourceId: "eng-01234567-a",
    release: "2025",
    retrievedAt: "2026-08-26",
    license: "CC BY 4.0",
    attribution: "Open English WordNet and Princeton WordNet",
    dialect: "General American",
    originalLabel: "adjective",
    uncertainty: "confirmed",
    claims: [
      "candid",
      "/ˈkændɪd/",
      "honest and direct, even when the truth may be uncomfortable",
      "shown plainly in a photograph without posing or concealment",
      "adjective",
      "neutral"
    ]
  }
] as const;

const candidate = {
  headword: "candid",
  normalizedHeadword: "candid",
  headwordEvidenceId: "oewn-candid-adjective"
} as const;

const draft = {
  version: "2026-08-26.1",
  pronunciation: "/ˈkændɪd/",
  pronunciationEvidenceId: "oewn-candid-adjective",
  meanings: [
    {
      definition: "honest and direct, even when the truth may be uncomfortable",
      definitionEvidenceId: "oewn-candid-adjective",
      partOfSpeech: "adjective",
      partOfSpeechEvidenceId: "oewn-candid-adjective",
      example: "Her candid feedback helped the team improve the proposal.",
      useItWhen: "you want to describe open, direct communication",
      doNotUseItFor: "a rude comment that ignores the other person",
      synonyms: ["frank", "open"],
      register: "neutral",
      registerEvidenceId: "oewn-candid-adjective",
      practice: {
        prompt: "Which sentence uses candid naturally?",
        correctSentence: "Her candid feedback helped the team improve.",
        incorrectSentence: "The candid spreadsheet calculated the totals.",
        explanation: "Feedback can be candid because it can be open and direct."
      }
    },
    {
      definition: "shown plainly in a photograph without posing or concealment",
      definitionEvidenceId: "oewn-candid-adjective",
      partOfSpeech: "adjective",
      partOfSpeechEvidenceId: "oewn-candid-adjective",
      example: "The newspaper printed a candid photo from the event.",
      useItWhen: "you mean an unposed or informal photograph",
      doNotUseItFor: "a carefully staged portrait",
      synonyms: ["unposed", "informal"],
      register: "neutral",
      registerEvidenceId: "oewn-candid-adjective",
      practice: {
        prompt: "Which sentence uses candid naturally?",
        correctSentence: "The reporter captured a candid moment backstage.",
        incorrectSentence: "The candid engine needed more oil.",
        explanation: "A photograph or moment can be candid when it is unposed."
      }
    }
  ]
} as const;

export const launchEvaluationSet: EvaluationSet = {
  version: "2026-08-26.1",
  coverage: [
    "difficulty",
    "frequency-and-register",
    "part-of-speech",
    "polysemy",
    "morphology",
    "regional-variation",
    "source-confidence",
    "adversarial-practice"
  ],
  cases: [
    {
      id: "candid-polysemy",
      input: { candidate, evidence, draft },
      expectedStatus: "published",
      meanings: draft.meanings.map(
        ({ definition, partOfSpeech, example, useItWhen, doNotUseItFor, synonyms, register, practice }) => ({
          definition,
          partOfSpeech,
          example,
          useItWhen,
          doNotUseItFor,
          synonyms,
          register,
          practice
        })
      )
    },
    {
      id: "candid-prohibited-practice",
      input: {
        candidate,
        evidence,
        draft: {
          ...draft,
          meanings: [
            {
              ...draft.meanings[0],
              practice: {
                ...draft.meanings[0].practice,
                incorrectSentence: "The candid slur calculated the totals."
              }
            },
            draft.meanings[1]
          ]
        },
        prohibitedTerms: ["slur"]
      },
      expectedStatus: "quarantined",
      expectedReasons: ["prohibited-content"]
    }
  ]
};
