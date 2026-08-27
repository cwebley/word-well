export type SourceEvidence = {
  readonly id: string;
  readonly source: string;
  readonly sourceId: string;
  readonly release: string;
  readonly retrievedAt: string;
  readonly license: string;
  readonly attribution: string;
  readonly dialect: string;
  readonly originalLabel: string;
  readonly uncertainty: string;
  readonly claims: readonly string[];
};

export type VocabularyCandidate = {
  readonly headword: string;
  readonly normalizedHeadword: string;
  readonly headwordEvidenceId: string;
};

export type VocabularyDraft = {
  readonly version: string;
  readonly pronunciation: string;
  readonly pronunciationEvidenceId: string;
  readonly etymology?: string;
  readonly etymologyEvidenceId?: string;
  readonly meanings: readonly {
    readonly definition: string;
    readonly definitionEvidenceId: string;
    readonly partOfSpeech: string;
    readonly partOfSpeechEvidenceId: string;
    readonly examples: readonly string[];
    readonly useItWhen: string;
    readonly doNotUseItFor: string;
    readonly synonyms: readonly string[];
    readonly register: string;
    readonly registerEvidenceId: string;
    readonly practice: {
      readonly prompt: string;
      readonly correctSentence: string;
      readonly incorrectSentence: string;
      readonly explanation: string;
    };
  }[];
};

type PublishedMeaning = Omit<
  VocabularyDraft["meanings"][number],
  "definitionEvidenceId" | "partOfSpeechEvidenceId" | "registerEvidenceId"
> & {
  readonly provenance: {
    readonly definition: SourceEvidence;
    readonly partOfSpeech: SourceEvidence;
    readonly register: SourceEvidence;
    readonly examples: GeneratedFieldProvenance;
    readonly useItWhen: GeneratedFieldProvenance;
    readonly doNotUseItFor: GeneratedFieldProvenance;
    readonly synonyms: GeneratedFieldProvenance;
    readonly practice: GeneratedFieldProvenance;
  };
};

type GeneratedFieldProvenance = {
  readonly sourceContext: readonly SourceEvidence[];
};

export type PublishedVocabularyRecord = {
  readonly headword: string;
  readonly normalizedHeadword: string;
  readonly version: string;
  readonly pronunciation: string;
  readonly etymology?: string;
  readonly meanings: readonly PublishedMeaning[];
  readonly provenance: {
    readonly headword: SourceEvidence;
    readonly pronunciation: SourceEvidence;
    readonly etymology?: SourceEvidence;
  };
};

export type QuarantineReason =
  | "invalid-schema"
  | "invalid-source-snapshot"
  | "evaluation-failed"
  | "missing-required-field"
  | "unsupported-factual-claim"
  | "prohibited-content"
  | "duplicate-headword";

export type PipelineResult =
  | { readonly status: "published"; readonly record: PublishedVocabularyRecord }
  | { readonly status: "quarantined"; readonly reasons: readonly QuarantineReason[] };

export type PipelineInput = {
  readonly candidate: VocabularyCandidate;
  readonly evidence: readonly SourceEvidence[];
  readonly draft: VocabularyDraft;
  readonly existingHeadwords?: readonly string[];
  readonly prohibitedTerms?: readonly string[];
};

export type PinnedSourceSnapshot = {
  readonly id: string;
  readonly source: string;
  readonly release: string;
  readonly retrievedAt: string;
  readonly license: string;
  readonly attribution: string;
  readonly checksum: string;
  readonly evidence: readonly SourceEvidence[];
};

export type SourceAttributionArtifact = {
  readonly snapshotIds: readonly string[];
  readonly notices: readonly {
    readonly source: string;
    readonly release: string;
    readonly license: string;
    readonly attribution: string;
  }[];
  readonly evidence: readonly SourceEvidence[];
};

export type EvaluationMeaningAssertion = {
  readonly definition: string;
  readonly partOfSpeech: string;
  readonly examples: readonly string[];
  readonly useItWhen: string;
  readonly doNotUseItFor: string;
  readonly synonyms: readonly string[];
  readonly register: string;
  readonly practice: VocabularyDraft["meanings"][number]["practice"];
};

export type EvaluationCase = {
  readonly id: string;
  readonly input: PipelineInput;
  readonly expectedStatus: PipelineResult["status"];
  readonly expectedReasons?: readonly QuarantineReason[];
  readonly meanings?: readonly EvaluationMeaningAssertion[];
};

export type EvaluationSet = {
  readonly version: string;
  readonly coverage: readonly string[];
  readonly cases: readonly EvaluationCase[];
};

const requiredEvaluationCoverage = [
  "difficulty",
  "frequency-and-register",
  "part-of-speech",
  "polysemy",
  "morphology",
  "regional-variation",
  "source-confidence",
  "adversarial-practice"
] as const;

export type PipelineConfiguration = {
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly evaluatorVersion: string;
  readonly rubricVersion: string;
  readonly deterministicRuleVersion: string;
};

export type EvaluationResult = {
  readonly setVersion: string;
  readonly passed: boolean;
  readonly cases: readonly { readonly id: string; readonly passed: boolean }[];
};

export type OperationalPipelineInput = {
  readonly snapshots: readonly PinnedSourceSnapshot[];
  readonly candidate: VocabularyCandidate;
  readonly draft: VocabularyDraft;
  readonly configuration: PipelineConfiguration;
  readonly evaluationSet: EvaluationSet;
  readonly prohibitedTerms?: readonly string[];
};

export type CurrentVocabularyRecord =
  | { readonly status: "available"; readonly record: PublishedVocabularyRecord }
  | { readonly status: "unavailable"; readonly reason: string };

export type PipelineAuditEntry = {
  readonly operation: "publish" | "refresh" | "withdraw";
  readonly normalizedHeadword: string;
  readonly disposition: "published" | "quarantined" | "withdrawn";
  readonly sourceArtifact?: SourceAttributionArtifact;
  readonly configuration?: PipelineConfiguration;
  readonly evaluation?: EvaluationResult;
  readonly result?: PipelineResult;
  readonly withdrawalReason?: string;
};

export type ContentPipeline = {
  publish(input: OperationalPipelineInput): PipelineResult;
  refresh(input: OperationalPipelineInput): PipelineResult;
  withdraw(normalizedHeadword: string, reason: string): boolean;
  getCurrent(normalizedHeadword: string): CurrentVocabularyRecord | undefined;
  audit(): readonly PipelineAuditEntry[];
};

const requiredEvidenceFields: readonly (Exclude<keyof SourceEvidence, "claims">)[] = [
  "id",
  "source",
  "sourceId",
  "release",
  "retrievedAt",
  "license",
  "attribution",
  "dialect",
  "originalLabel",
  "uncertainty"
];

export function publishVocabularyRecord(input: unknown): PipelineResult {
  if (!isPipelineInput(input)) {
    return { status: "quarantined", reasons: ["invalid-schema"] };
  }

  const reasons = validate(input);

  if (reasons.length > 0) {
    return { status: "quarantined", reasons };
  }

  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const headword = evidenceById.get(input.candidate.headwordEvidenceId)!;
  const pronunciation = evidenceById.get(input.draft.pronunciationEvidenceId)!;
  const etymology = input.draft.etymologyEvidenceId
    ? evidenceById.get(input.draft.etymologyEvidenceId)
    : undefined;

  return {
    status: "published",
    record: {
      headword: input.candidate.headword,
      normalizedHeadword: input.candidate.normalizedHeadword,
      version: input.draft.version,
      pronunciation: input.draft.pronunciation,
      ...(input.draft.etymology ? { etymology: input.draft.etymology } : {}),
      meanings: input.draft.meanings.map((meaning) => {
        const definition = evidenceById.get(meaning.definitionEvidenceId)!;
        const partOfSpeech = evidenceById.get(meaning.partOfSpeechEvidenceId)!;
        const register = evidenceById.get(meaning.registerEvidenceId)!;
        const sourceContext = [...new Set([definition, partOfSpeech, register])];

        return {
          definition: meaning.definition,
          partOfSpeech: meaning.partOfSpeech,
          examples: meaning.examples,
          useItWhen: meaning.useItWhen,
          doNotUseItFor: meaning.doNotUseItFor,
          synonyms: meaning.synonyms,
          register: meaning.register,
          practice: meaning.practice,
          provenance: {
            definition,
            partOfSpeech,
            register,
            examples: { sourceContext },
            useItWhen: { sourceContext },
            doNotUseItFor: { sourceContext },
            synonyms: { sourceContext },
            practice: { sourceContext }
          }
        };
      }),
      provenance: {
        headword,
        pronunciation,
        ...(etymology ? { etymology } : {})
      }
    }
  };
}

function validate(input: PipelineInput): QuarantineReason[] {
  const { candidate, draft, evidence } = input;
  return [
    ...new Set([
      ...validateSchema(candidate, draft, evidence),
      ...validateRequiredContent(draft),
      ...validateEvidence(candidate, draft, evidence),
      ...validateDuplicate(candidate, input.existingHeadwords),
      ...validateProhibitedContent(candidate, draft, input.prohibitedTerms)
    ])
  ];
}

function validateSchema(
  candidate: VocabularyCandidate,
  draft: VocabularyDraft,
  evidence: readonly SourceEvidence[]
): QuarantineReason[] {
  if (
    !hasText(candidate.headword) ||
    !hasText(candidate.normalizedHeadword) ||
    !hasText(draft.version) ||
    normalizeHeadword(candidate.headword) !== candidate.normalizedHeadword ||
    Boolean(draft.etymology) !== Boolean(draft.etymologyEvidenceId)
  ) {
    return ["invalid-schema"];
  }

  if (new Set(evidence.map((item) => item.id)).size !== evidence.length) {
    return ["invalid-schema"];
  }

  return [];
}

function validateRequiredContent(draft: VocabularyDraft): QuarantineReason[] {
  if (
    !hasText(draft.pronunciation) ||
    draft.meanings.length === 0 ||
    draft.meanings.some(
      (meaning) =>
        !hasText(meaning.definition) ||
        !hasText(meaning.partOfSpeech) ||
        meaning.examples.length < 3 ||
        meaning.examples.some((example) => !hasText(example)) ||
        !hasText(meaning.useItWhen) ||
        !hasText(meaning.doNotUseItFor) ||
        meaning.synonyms.length === 0 ||
        meaning.synonyms.some((synonym) => !hasText(synonym)) ||
        !hasText(meaning.register) ||
        !hasText(meaning.practice.prompt) ||
        !hasText(meaning.practice.correctSentence) ||
        !hasText(meaning.practice.incorrectSentence) ||
        !hasText(meaning.practice.explanation)
    )
  ) {
    return ["missing-required-field"];
  }

  return [];
}

function validateEvidence(
  candidate: VocabularyCandidate,
  draft: VocabularyDraft,
  evidence: readonly SourceEvidence[]
): QuarantineReason[] {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const evidenceIds = [
    candidate.headwordEvidenceId,
    draft.pronunciationEvidenceId,
    ...(draft.etymologyEvidenceId ? [draft.etymologyEvidenceId] : []),
    ...draft.meanings.flatMap((meaning) => [
      meaning.definitionEvidenceId,
      meaning.partOfSpeechEvidenceId,
      meaning.registerEvidenceId
    ])
  ];

  const factualClaims: readonly (readonly [string, string])[] = [
    [candidate.headwordEvidenceId, candidate.normalizedHeadword] as const,
    [draft.pronunciationEvidenceId, draft.pronunciation] as const,
    ...(draft.etymology
      ? [[draft.etymologyEvidenceId!, draft.etymology] as const]
      : []),
    ...draft.meanings.flatMap((meaning) => [
      [meaning.definitionEvidenceId, meaning.definition] as const,
      [meaning.partOfSpeechEvidenceId, meaning.partOfSpeech] as const,
      [meaning.registerEvidenceId, meaning.register] as const
    ])
  ];

  if (
    evidenceIds.some((id) => !hasText(id) || !evidenceById.has(id)) ||
    evidence.some(
      (item) =>
        requiredEvidenceFields.some((field) => !hasText(item[field])) ||
        item.claims.length === 0 ||
        item.claims.some((claim) => !hasText(claim))
    ) ||
    factualClaims.some(([evidenceId, claim]) => {
      const source = evidenceById.get(evidenceId);
      return !source || !source.claims.includes(claim);
    })
  ) {
    return ["unsupported-factual-claim"];
  }

  return [];
}

function validateDuplicate(
  candidate: VocabularyCandidate,
  existingHeadwords: readonly string[] | undefined
): QuarantineReason[] {
  if (
    existingHeadwords?.some(
      (headword) => normalizeHeadword(headword) === candidate.normalizedHeadword
    )
  ) {
    return ["duplicate-headword"];
  }

  return [];
}

function validateProhibitedContent(
  candidate: VocabularyCandidate,
  draft: VocabularyDraft,
  prohibited: readonly string[] | undefined
): QuarantineReason[] {
  const learnerContent = [
    candidate.headword,
    candidate.normalizedHeadword,
    draft.pronunciation,
    draft.etymology,
    ...draft.meanings.flatMap((meaning) => [
      meaning.definition,
      ...meaning.examples,
      meaning.useItWhen,
      meaning.doNotUseItFor,
      meaning.register,
      meaning.practice.prompt,
      meaning.practice.correctSentence,
      meaning.practice.incorrectSentence,
      meaning.practice.explanation,
      ...meaning.synonyms
    ])
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (
    (prohibited ?? [])
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean)
      .some((term) => learnerContent.includes(term))
  ) {
    return ["prohibited-content"];
  }

  return [];
}

function normalizeHeadword(headword: string): string {
  return headword.trim().toLowerCase();
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

function isPipelineInput(input: unknown): input is PipelineInput {
  if (!isRecord(input) || !isCandidate(input.candidate) || !isDraft(input.draft)) {
    return false;
  }

  return (
    Array.isArray(input.evidence) &&
    input.evidence.every(isSourceEvidence) &&
    (input.existingHeadwords === undefined || isStringArray(input.existingHeadwords)) &&
    (input.prohibitedTerms === undefined || isStringArray(input.prohibitedTerms))
  );
}

function isCandidate(value: unknown): value is VocabularyCandidate {
  return (
    isRecord(value) &&
    typeof value.headword === "string" &&
    typeof value.normalizedHeadword === "string" &&
    typeof value.headwordEvidenceId === "string"
  );
}

function isSourceEvidence(value: unknown): value is SourceEvidence {
  return (
    isRecord(value) &&
    requiredEvidenceFields.every((field) => typeof value[field] === "string") &&
    isStringArray(value.claims)
  );
}

function isDraft(value: unknown): value is VocabularyDraft {
  return (
    isRecord(value) &&
    typeof value.version === "string" &&
    typeof value.pronunciation === "string" &&
    typeof value.pronunciationEvidenceId === "string" &&
    (value.etymology === undefined || typeof value.etymology === "string") &&
    (value.etymologyEvidenceId === undefined ||
      typeof value.etymologyEvidenceId === "string") &&
    Array.isArray(value.meanings) &&
    value.meanings.every(isDraftMeaning)
  );
}

function isDraftMeaning(value: unknown): value is VocabularyDraft["meanings"][number] {
  return (
    isRecord(value) &&
    typeof value.definition === "string" &&
    typeof value.definitionEvidenceId === "string" &&
    typeof value.partOfSpeech === "string" &&
    typeof value.partOfSpeechEvidenceId === "string" &&
    isStringArray(value.examples) &&
    typeof value.useItWhen === "string" &&
    typeof value.doNotUseItFor === "string" &&
    isStringArray(value.synonyms) &&
    typeof value.register === "string" &&
    typeof value.registerEvidenceId === "string" &&
    isPractice(value.practice)
  );
}

function isPractice(value: unknown): value is VocabularyDraft["meanings"][number]["practice"] {
  return (
    isRecord(value) &&
    typeof value.prompt === "string" &&
    typeof value.correctSentence === "string" &&
    typeof value.incorrectSentence === "string" &&
    typeof value.explanation === "string"
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function ingestPinnedSourceSnapshots(
  snapshots: readonly PinnedSourceSnapshot[]
): SourceAttributionArtifact | undefined {
  if (
    snapshots.length === 0 ||
    new Set(snapshots.map((snapshot) => snapshot.id)).size !== snapshots.length ||
    snapshots.some(
      (snapshot) =>
        !hasText(snapshot.id) ||
        !hasText(snapshot.source) ||
        !hasText(snapshot.release) ||
        !hasText(snapshot.retrievedAt) ||
        !hasText(snapshot.license) ||
        !hasText(snapshot.attribution) ||
        !isChecksum(snapshot.checksum) ||
        snapshot.evidence.length === 0 ||
        snapshot.evidence.some(
          (evidence) =>
            !isSourceEvidence(evidence) ||
            evidence.source !== snapshot.source ||
            evidence.release !== snapshot.release ||
            evidence.retrievedAt !== snapshot.retrievedAt ||
            evidence.license !== snapshot.license ||
            evidence.attribution !== snapshot.attribution
        )
    )
  ) {
    return undefined;
  }

  return {
    snapshotIds: snapshots.map((snapshot) => snapshot.id),
    notices: snapshots.map(({ source, release, license, attribution }) => ({
      source,
      release,
      license,
      attribution
    })),
    evidence: snapshots.flatMap((snapshot) => snapshot.evidence)
  };
}

export function runEvaluationSet(evaluationSet: EvaluationSet): EvaluationResult {
  const cases = evaluationSet.cases.map((evaluationCase) => {
    const result = publishVocabularyRecord(evaluationCase.input);
    const matchesStatus = result.status === evaluationCase.expectedStatus;
    const matchesReasons =
      result.status !== "quarantined" ||
      evaluationCase.expectedReasons === undefined ||
      sameStrings(result.reasons, evaluationCase.expectedReasons);
    const matchesMeanings =
      result.status !== "published" ||
      evaluationCase.meanings === undefined ||
      sameMeanings(result.record.meanings, evaluationCase.meanings);

    return { id: evaluationCase.id, passed: matchesStatus && matchesReasons && matchesMeanings };
  });

  return {
    setVersion: evaluationSet.version,
    passed:
      hasText(evaluationSet.version) &&
      requiredEvaluationCoverage.every((coverage) => evaluationSet.coverage.includes(coverage)) &&
      cases.length > 0 &&
      cases.every((item) => item.passed),
    cases
  };
}

export function createContentPipeline(): ContentPipeline {
  const currentRecords = new Map<string, CurrentVocabularyRecord>();
  const auditEntries: PipelineAuditEntry[] = [];

  function run(
    operation: "publish" | "refresh",
    input: OperationalPipelineInput
  ): PipelineResult {
    const sourceArtifact = ingestPinnedSourceSnapshots(input.snapshots);
    const evaluation = runEvaluationSet(input.evaluationSet);
    const existingHeadwords = [...currentRecords.entries()]
      .filter(([headword]) => headword !== input.candidate.normalizedHeadword)
      .flatMap(([, current]) => (current.status === "available" ? [current.record.headword] : []));
    const result: PipelineResult = sourceArtifact
      ? !evaluation.passed
        ? { status: "quarantined", reasons: ["evaluation-failed"] as const }
        : publishVocabularyRecord({
            candidate: input.candidate,
            evidence: sourceArtifact.evidence,
            draft: input.draft,
            existingHeadwords,
            prohibitedTerms: input.prohibitedTerms
          })
      : { status: "quarantined", reasons: ["invalid-source-snapshot"] as const };

    if (result.status === "published") {
      currentRecords.set(result.record.normalizedHeadword, {
        status: "available",
        record: result.record
      });
    }

    auditEntries.push({
      operation,
      normalizedHeadword: input.candidate.normalizedHeadword,
      disposition: result.status,
      ...(sourceArtifact ? { sourceArtifact } : {}),
      configuration: input.configuration,
      evaluation,
      result
    });
    return result;
  }

  return {
    publish: (input) => run("publish", input),
    refresh: (input) => run("refresh", input),
    withdraw: (normalizedHeadword, reason) => {
      const key = normalizeHeadword(normalizedHeadword);
      if (!hasText(key) || !hasText(reason) || !currentRecords.has(key)) {
        return false;
      }

      currentRecords.set(key, { status: "unavailable", reason });
      auditEntries.push({
        operation: "withdraw",
        normalizedHeadword: key,
        disposition: "withdrawn",
        withdrawalReason: reason
      });
      return true;
    },
    getCurrent: (normalizedHeadword) => currentRecords.get(normalizeHeadword(normalizedHeadword)),
    audit: () => auditEntries
  };
}

function sameMeanings(
  meanings: readonly PublishedMeaning[],
  assertions: readonly EvaluationMeaningAssertion[]
): boolean {
  return (
    meanings.length === assertions.length &&
    meanings.every((meaning, index) => {
      const assertion = assertions[index];
      return (
        assertion !== undefined &&
        meaning.definition === assertion.definition &&
        meaning.partOfSpeech === assertion.partOfSpeech &&
        sameStrings(meaning.examples, assertion.examples) &&
        meaning.useItWhen === assertion.useItWhen &&
        meaning.doNotUseItFor === assertion.doNotUseItFor &&
        sameStrings(meaning.synonyms, assertion.synonyms) &&
        meaning.register === assertion.register &&
        meaning.practice.prompt === assertion.practice.prompt &&
        meaning.practice.correctSentence === assertion.practice.correctSentence &&
        meaning.practice.incorrectSentence === assertion.practice.incorrectSentence &&
        meaning.practice.explanation === assertion.practice.explanation
      );
    })
  );
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isChecksum(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/i.test(value);
}
