import { describe, expect, it } from "vitest";
import {
  createContentPipeline,
  ingestPinnedSourceSnapshots,
  publishVocabularyRecord,
  runEvaluationSet,
  type EvaluationSet,
  type OperationalPipelineInput,
  type VocabularyDraft
} from "./content-pipeline";
import { launchEvaluationSet } from "./content-pipeline.evaluation-set";

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

  it("ingests pinned source snapshots into notices and attribution artifacts", () => {
    const artifact = ingestPinnedSourceSnapshots([
      {
        id: "oewn-2025",
        source: evidence[0].source,
        release: evidence[0].release,
        retrievedAt: evidence[0].retrievedAt,
        license: evidence[0].license,
        attribution: evidence[0].attribution,
        checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        evidence: [evidence[0]]
      },
      {
        id: "wiktionary-2026-08-01",
        source: evidence[1].source,
        release: evidence[1].release,
        retrievedAt: evidence[1].retrievedAt,
        license: evidence[1].license,
        attribution: evidence[1].attribution,
        checksum: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        evidence: [evidence[1]]
      }
    ]);

    expect(artifact).toEqual({
      snapshotIds: ["oewn-2025", "wiktionary-2026-08-01"],
      notices: [
        {
          source: evidence[0].source,
          release: evidence[0].release,
          license: evidence[0].license,
          attribution: evidence[0].attribution
        },
        {
          source: evidence[1].source,
          release: evidence[1].release,
          license: evidence[1].license,
          attribution: evidence[1].attribution
        }
      ],
      evidence
    });
  });

  it("runs the versioned evaluation set, including its adversarial lesson", () => {
    expect(runEvaluationSet(launchEvaluationSet)).toEqual({
      setVersion: "2026-08-26.1",
      passed: true,
      cases: [
        { id: "candid-polysemy", passed: true },
        { id: "candid-prohibited-practice", passed: true }
      ]
    });
  });

  it("quarantines publication when an evaluation regression is detected", () => {
    const pipeline = createContentPipeline();
    const result = pipeline.publish(operationalInput({
      ...launchEvaluationSet,
      cases: [{ ...launchEvaluationSet.cases[0], expectedStatus: "quarantined" }]
    }));

    expect(result).toEqual({ status: "quarantined", reasons: ["evaluation-failed"] });
    expect(pipeline.getCurrent("candid")).toBeUndefined();
    expect(pipeline.audit()[0]).toMatchObject({
      disposition: "quarantined",
      evaluation: { passed: false }
    });
  });

  it("rejects an incomplete evaluation set before publication", () => {
    const pipeline = createContentPipeline();
    const result = pipeline.publish(
      operationalInput({ ...launchEvaluationSet, coverage: ["polysemy"] })
    );

    expect(result).toEqual({ status: "quarantined", reasons: ["evaluation-failed"] });
  });

  it("quarantines malformed pinned snapshots while retaining the attempted audit entry", () => {
    const pipeline = createContentPipeline();
    const input = operationalInput();
    const result = pipeline.publish({
      ...input,
      snapshots: [{ ...input.snapshots[0], checksum: "" }]
    });

    expect(result).toEqual({ status: "quarantined", reasons: ["invalid-source-snapshot"] });
    expect(pipeline.audit()[0]).toMatchObject({ disposition: "quarantined" });
    expect(pipeline.audit()[0]).not.toHaveProperty("sourceArtifact");
  });

  it("replaces qualified current content, withdraws defects, and retains the audit trail", () => {
    const pipeline = createContentPipeline();
    expect(pipeline.publish(operationalInput())).toMatchObject({ status: "published" });

    expect(
      pipeline.refresh(
        operationalInput(launchEvaluationSet, { ...draft, version: "2026-08-27.1" })
      )
    ).toMatchObject({ status: "published" });
    expect(pipeline.getCurrent("candid")).toMatchObject({
      status: "available",
      record: { version: "2026-08-27.1" }
    });

    expect(pipeline.withdraw("CANDID", "material factual defect")).toBe(true);
    expect(pipeline.getCurrent("candid")).toEqual({
      status: "unavailable",
      reason: "material factual defect"
    });
    expect(pipeline.audit()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "publish", sourceArtifact: expect.any(Object) }),
        expect.objectContaining({ operation: "refresh", result: expect.objectContaining({ status: "published" }) }),
        expect.objectContaining({ operation: "withdraw", disposition: "withdrawn" })
      ])
    );
  });
});

function operationalInput(
  evaluationSet: EvaluationSet = launchEvaluationSet,
  replacementDraft: VocabularyDraft = draft
): OperationalPipelineInput {
  return {
    snapshots: [
      {
        id: "oewn-2025",
        source: evidence[0].source,
        release: evidence[0].release,
        retrievedAt: evidence[0].retrievedAt,
        license: evidence[0].license,
        attribution: evidence[0].attribution,
        checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        evidence: [evidence[0]]
      },
      {
        id: "wiktionary-2026-08-01",
        source: evidence[1].source,
        release: evidence[1].release,
        retrievedAt: evidence[1].retrievedAt,
        license: evidence[1].license,
        attribution: evidence[1].attribution,
        checksum: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        evidence: [evidence[1]]
      }
    ],
    candidate,
    draft: replacementDraft,
    configuration: {
      modelVersion: "model-1",
      promptVersion: "prompt-1",
      evaluatorVersion: "evaluator-1",
      rubricVersion: "rubric-1",
      deterministicRuleVersion: "rules-1"
    },
    evaluationSet
  };
}
