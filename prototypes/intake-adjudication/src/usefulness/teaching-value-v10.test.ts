import { describe, expect, it } from "vitest";

import type { CandidateMeaning } from "./meaning.ts";
import { renderTeachingValueSubject } from "./teaching-value-v10.ts";

const subject: CandidateMeaning = {
  subject_id: "exuberant|sense",
  extraction_version: "usefulness-evidence/1",
  input_digest: "digest",
  candidate: {
    normalized: "exuberant",
    display: "exuberant",
    pos: ["a"],
    zipf: 2.97,
    meaning_count: 1,
  },
  meaning: {
    sense_id: "sense",
    pos: "a",
    lemma: "exuberant",
    definition: "joyously unrestrained",
    examples: [],
    examples_truncated: false,
    synset_members: ["ebullient", "exuberant", "high-spirited"],
  },
  missing_evidence: [],
  policy_context: { endorsements: 2 },
};

describe("the v10 synonym ablation", () => {
  it("preserves synonym evidence in the historical v10 input", () => {
    expect(renderTeachingValueSubject(subject, { includeSynonyms: true })).toContain(
      "recorded alongside: ebullient, exuberant, high-spirited",
    );
  });

  it("omits only synonym evidence from the v11 input", () => {
    const rendered = renderTeachingValueSubject(subject, {
      includeDefinition: true,
      includeSynonyms: false,
    });
    expect(rendered).toContain("definition: joyously unrestrained");
    expect(rendered).toContain("part of speech: a");
    expect(rendered).not.toContain("recorded alongside");
    expect(rendered).not.toContain("ebullient");
  });

  it("also omits definitions from the v12 input", () => {
    const rendered = renderTeachingValueSubject(subject, {
      includeDefinition: false,
      includeSynonyms: false,
    });
    expect(rendered).not.toContain("definition: joyously unrestrained");
    expect(rendered).not.toContain("recorded alongside");
    expect(rendered).toContain("part of speech: a");
  });
});
