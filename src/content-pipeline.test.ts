import { describe, expect, it } from "vitest";
import { publishVocabularyRecord } from "./content-pipeline";

const candidate = {
  headword: "candid",
  normalizedHeadword: "candid",
  headwordEvidenceId: "oewn-candid-adjective"
};

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
  },
  {
    id: "wiktionary-candid-etymology",
    source: "English Wiktionary",
    sourceId: "candid#Etymology",
    release: "2026-08-01 dump",
    retrievedAt: "2026-08-26",
    license: "CC BY-SA 4.0",
    attribution: "English Wiktionary contributors",
    dialect: "General American",
    originalLabel: "Etymology",
    uncertainty: "probable",
    claims: ["From Latin candidus, meaning white or shining."]
  }
] as const;

const draft = {
  version: "2026-08-26.1",
  pronunciation: "/ˈkændɪd/",
  pronunciationEvidenceId: "oewn-candid-adjective",
  etymology: "From Latin candidus, meaning white or shining.",
  etymologyEvidenceId: "wiktionary-candid-etymology",
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

describe("content pipeline", () => {
  it("publishes a versioned multi-meaning record with field provenance", () => {
    const result = publishVocabularyRecord({ candidate, evidence, draft });

    expect(result).toEqual({
      status: "published",
      record: expect.objectContaining({
        headword: "candid",
        version: "2026-08-26.1",
        meanings: expect.arrayContaining([
          expect.objectContaining({
            definition: draft.meanings[0].definition,
            provenance: expect.objectContaining({
              definition: evidence[0],
              partOfSpeech: evidence[0],
              register: evidence[0]
            })
          }),
          expect.objectContaining({
            definition: draft.meanings[1].definition
          })
        ]),
        provenance: expect.objectContaining({
          headword: evidence[0],
          pronunciation: evidence[0],
          etymology: evidence[1]
        })
      })
    });
  });

  it("quarantines duplicate evidence identifiers as invalid schema", () => {
    const result = publishVocabularyRecord({
      candidate,
      evidence: [...evidence, evidence[0]],
      draft
    });

    expect(result).toMatchObject({
      status: "quarantined",
      reasons: expect.arrayContaining(["invalid-schema"])
    });
  });

  it("quarantines a candidate whose normalized headword does not match", () => {
    const result = publishVocabularyRecord({
      candidate: { ...candidate, headword: "Candid", normalizedHeadword: "direct" },
      evidence,
      draft
    });

    expect(result).toMatchObject({
      status: "quarantined",
      reasons: expect.arrayContaining(["invalid-schema"])
    });
  });

  it("quarantines missing, unsupported, prohibited, and duplicate content", () => {
    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft: {
          ...draft,
          meanings: [{ ...draft.meanings[0], example: "" }]
        }
      })
    ).toEqual({ status: "quarantined", reasons: ["missing-required-field"] });

    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft: { ...draft, pronunciationEvidenceId: "missing-evidence" }
      })
    ).toEqual({
      status: "quarantined",
      reasons: ["unsupported-factual-claim"]
    });

    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft: {
          ...draft,
          meanings: [
            {
              ...draft.meanings[0],
              definition: "an unsupported definition"
            }
          ]
        }
      })
    ).toEqual({
      status: "quarantined",
      reasons: ["unsupported-factual-claim"]
    });

    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft,
        prohibitedTerms: ["uncomfortable"]
      })
    ).toEqual({ status: "quarantined", reasons: ["prohibited-content"] });

    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft,
        existingHeadwords: ["CANDID"]
      })
    ).toEqual({ status: "quarantined", reasons: ["duplicate-headword"] });
  });

  it("returns the same artifact for the same fixture input", () => {
    const input = { candidate, evidence, draft };

    expect(publishVocabularyRecord(input)).toEqual(publishVocabularyRecord(input));
  });

  it("quarantines incomplete provenance and malformed optional evidence", () => {
    expect(
      publishVocabularyRecord({
        candidate,
        evidence: [{ ...evidence[0], license: " " }, evidence[1]],
        draft
      })
    ).toEqual({
      status: "quarantined",
      reasons: ["unsupported-factual-claim"]
    });

    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft: { ...draft, etymology: undefined, etymologyEvidenceId: "missing" }
      })
    ).toMatchObject({
      status: "quarantined",
      reasons: expect.arrayContaining(["invalid-schema"])
    });
  });

  it("quarantines blank content and malformed runtime input", () => {
    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft: { ...draft, version: " " }
      })
    ).toEqual({ status: "quarantined", reasons: ["invalid-schema"] });

    expect(
      publishVocabularyRecord({
        candidate,
        evidence,
        draft: { ...draft, meanings: undefined }
      })
    ).toEqual({ status: "quarantined", reasons: ["invalid-schema"] });
  });

  it("does not allow a blank prohibited term to quarantine every record", () => {
    expect(
      publishVocabularyRecord({ candidate, evidence, draft, prohibitedTerms: [" "] })
    ).toMatchObject({ status: "published" });
  });
});
