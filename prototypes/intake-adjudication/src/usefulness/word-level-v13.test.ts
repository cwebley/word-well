import { describe, expect, it } from "vitest";

import type { HeadwordGroup } from "./run.ts";
import {
  buildHeadwordSubject,
  renderWordLevelSubject,
  V13_RUBRIC,
  V14_RUBRIC,
  wordLevelVerdict,
  type WordLevelFinding,
} from "./word-level-v13.ts";

const group = {
  headword: "clog",
  display: "clog",
  meanings: [
    {
      candidate: { pos: ["v", "n"] },
      policy_context: { endorsements: 2 },
    },
  ],
} as HeadwordGroup;

describe("v13 word-level diagnostic", () => {
  it("renders only the headword and its parts of speech", () => {
    const rendered = renderWordLevelSubject(buildHeadwordSubject(group));
    expect(rendered).toBe("HEADWORD\nword: clog\nrecorded parts of speech: n, v");
    expect(rendered).not.toContain("definition");
    expect(rendered).not.toContain("meaning");
    expect(rendered).not.toContain("example");
  });

  it("does not make common familiarity an automatic exclusion", () => {
    const finding: WordLevelFinding = {
      headword: "nuance",
      familiarity: "common",
      scope: "general",
      learning_value: "high",
      rationale: "Mastery adds precision.",
    };
    expect(wordLevelVerdict(finding)).toBe("useful");
  });

  it("rejects low-value and specialist headwords", () => {
    const base: WordLevelFinding = {
      headword: "clog",
      familiarity: "common",
      scope: "general",
      learning_value: "low",
      rationale: "Mundane.",
    };
    expect(wordLevelVerdict(base)).toBe("not_useful");
    expect(wordLevelVerdict({ ...base, scope: "specialist_subject", learning_value: "high" })).toBe(
      "not_useful",
    );
  });

  it("keeps v14 focused on the headword-level core", () => {
    expect(V14_RUBRIC).toContain("Judge the\nheadword as a whole");
    expect(V14_RUBRIC).toContain("Do not rescue a mundane word");
    expect(V14_RUBRIC).not.toContain("A common or recognizable headword");
    expect(V14_RUBRIC).not.toContain("Broad applicability alone");
    expect(V14_RUBRIC).not.toContain("Do not penalize a useful word only because it is rare");
    expect(V14_RUBRIC.length).toBeLessThan(V13_RUBRIC.length);
  });
});
