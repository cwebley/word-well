import { describe, expect, it } from "vitest";

import { usefulnessFindingSchema } from "./contract.ts";
import { usefulnessGate } from "./gate.ts";
import { citableEvidenceIds, evidenceItems, readCandidateMeanings } from "./meaning.ts";
import { renderSubject } from "./prompt.ts";

const subjects = readCandidateMeanings("evidence/usefulness-golden-v2.meanings.jsonl");
const laconic = subjects.find((s) => s.subject_id.startsWith("laconic"))!;
const pinnate = subjects.find((s) => s.subject_id.startsWith("pinnate"))!;

describe("numbered evidence", () => {
  it("labels every piece of evidence the judge is shown", () => {
    const items = evidenceItems(laconic);
    expect(items.map((i) => i.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"]);
    expect(items.map((i) => i.kind)).toEqual([
      "definition", "example", "example", "example", "example", "synonyms", "frequency", "part_of_speech",
    ]);
  });

  it("gives the frequency a label, which is what version 1 could not", () => {
    // `pinnate` reasoned from the frequency and had to invent
    // `frequency_Zipf_2.17` to say so. Now there is a real label for it.
    const frequency = evidenceItems(pinnate).find((i) => i.kind === "frequency")!;
    expect(frequency.text).toBe("2.17");
    expect(citableEvidenceIds(pinnate).has(frequency.id)).toBe(true);
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
  it("no longer asks the model to rate itself", () => {
    expect(Object.keys(usefulnessFindingSchema.shape)).toEqual([
      "sense_id",
      "usefulness",
      "rationale",
      "evidence_ids",
    ]);
  });

  it("rejects a reply carrying a disposition the model invented", () => {
    const withDisposition = JSON.stringify({
      sense_id: laconic.meaning.sense_id,
      usefulness: "useful",
      rationale: "because",
      evidence_ids: ["E1"],
      disposition: "advance",
    });
    expect(usefulnessGate.parse(withDisposition, laconic).finding).toBeNull();
  });

  it("rejects a reply about a different meaning", () => {
    const wrongSense = JSON.stringify({
      sense_id: "oewn-somethingelse__1.00.00..",
      usefulness: "useful",
      rationale: "because",
      evidence_ids: ["E1"],
    });
    const result = usefulnessGate.parse(wrongSense, laconic);
    expect(result.finding).toBeNull();
    expect(result.error).toContain("subject identity lost");
  });
});
