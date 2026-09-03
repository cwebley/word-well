import { describe, expect, it } from "vitest";

import { usefulnessFindingSchema } from "./contract.ts";
import { usefulnessGate } from "./gate.ts";
import { citableEvidenceIds, evidenceItems, readCandidateMeanings } from "./meaning.ts";
import { renderSubject } from "./prompt.ts";

const subjects = readCandidateMeanings("evidence/usefulness-golden-v3.meanings.jsonl");
const laconic = subjects.find((s) => s.subject_id.startsWith("laconic"))!;
const pinnate = subjects.find((s) => s.subject_id.startsWith("pinnate"))!;

describe("numbered evidence", () => {
  it("labels every piece of evidence the judge is shown", () => {
    const items = evidenceItems(laconic);
    expect(items.map((i) => i.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7"]);
    expect(items.map((i) => i.kind)).toEqual([
      "definition", "example", "example", "example", "example", "synonyms", "part_of_speech",
    ]);
  });

  it("shows the judge no frequency at all, since usefulness-prompt/3", () => {
    // The field measured doing more harm than any other: 162 of 164 rejections
    // invoking rarity cited it directly. "Too common" is now a deterministic
    // filter, and "too rare" was never a reason to reject.
    for (const subject of subjects) {
      const rendered = renderSubject(subject);
      // Widened deliberately: the union no longer contains "frequency", so the
      // compiler already forbids this. The runtime check stays as the guard for
      // anyone who re-adds the kind without re-reading why it went.
      expect(evidenceItems(subject).map((i) => i.kind as string)).not.toContain("frequency");
      expect(rendered).not.toContain("Zipf");
      expect(rendered).not.toContain("frequency");
    }
    // The number is still on the record — the deterministic filter and every
    // report read it. It simply never reaches a prompt.
    expect(pinnate.candidate.zipf).toBe(2.17);
  });

  it("renders every label into the prompt, so a citation is always checkable", () => {
    const rendered = renderSubject(laconic);
    for (const item of evidenceItems(laconic)) {
      expect(rendered).toContain(`[${item.id}]`);
      expect(rendered).toContain(item.text);
    }
  });

  it("offers more than one citable label, unlike version 1", () => {
    // The defect this replaces: one legal identifier meant the field asked a
    // question with a single possible answer.
    for (const subject of subjects) {
      expect(citableEvidenceIds(subject).size).toBeGreaterThan(1);
    }
  });
});

describe("the usefulness contract", () => {
  it("records the exam level behind usefulness instead of a serving verdict", () => {
    expect(Object.keys(usefulnessFindingSchema.shape)).toEqual([
      "sense_id",
      "exam_level",
      "rationale",
      "evidence_ids",
    ]);

    expect(
      usefulnessFindingSchema.safeParse({
        sense_id: laconic.meaning.sense_id,
        exam_level: "high_school",
        rationale: "because",
        evidence_ids: ["E1"],
      }).success,
    ).toBe(true);
  });

  it("rejects a reply carrying a disposition the model invented", () => {
    const withDisposition = JSON.stringify({
      sense_id: laconic.meaning.sense_id,
      exam_level: "high_school",
      rationale: "because",
      evidence_ids: ["E1"],
      disposition: "advance",
    });
    expect(usefulnessGate.parse(withDisposition, laconic).finding).toBeNull();
  });

  it("rejects a reply about a different meaning", () => {
    const wrongSense = JSON.stringify({
      sense_id: "oewn-somethingelse__1.00.00..",
      exam_level: "high_school",
      rationale: "because",
      evidence_ids: ["E1"],
    });
    const result = usefulnessGate.parse(wrongSense, laconic);
    expect(result.finding).toBeNull();
    expect(result.error).toContain("subject identity lost");
  });
});
