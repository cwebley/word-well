import { describe, expect, it } from "vitest";

import type { Finding } from "./contract.ts";
import {
  applyEndorsement,
  deriveMorphologyDisposition,
  verdictOf,
} from "./policy.ts";

const derive = (
  analysisSupport: Parameters<typeof deriveMorphologyDisposition>[0]["analysisSupport"],
  predictabilities: Parameters<typeof deriveMorphologyDisposition>[0]["predictabilities"],
) => deriveMorphologyDisposition({ analysisSupport, predictabilities }).disposition;

describe("morphology disposition", () => {
  it("advances a claim the evidence does not support, whatever the meanings say", () => {
    expect(derive("unsupported", [])).toBe("advance");
    expect(derive("unsupported", ["predictable", "predictable"])).toBe("advance");
  });

  it("quarantines when the analysis itself cannot be settled", () => {
    expect(derive("insufficient_evidence", ["predictable"])).toBe("quarantine");
  });

  it("excludes only when every meaning follows from the claimed parts", () => {
    expect(derive("supported", ["predictable"])).toBe("exclude");
    expect(derive("supported", ["predictable", "predictable"])).toBe("exclude");
  });

  it("advances when one meaning teaches something the parts do not give", () => {
    expect(derive("supported", ["predictable", "not_predictable"])).toBe("advance");
  });

  it("quarantines when nothing was shown to teach anything and a meaning is undecided", () => {
    expect(derive("supported", ["predictable", "insufficient_evidence"])).toBe("quarantine");
    expect(derive("supported", ["insufficient_evidence"])).toBe("quarantine");
  });

  it("advances on one clear not_predictable, whatever else is undecided", () => {
    // v2. One meaning that demonstrably teaches something is reason enough to
    // keep the word; an undecided meaning beside it cannot withdraw that reason.
    expect(derive("supported", ["not_predictable", "insufficient_evidence"])).toBe("advance");
    expect(derive("supported", ["insufficient_evidence", "not_predictable"])).toBe("advance");
    expect(derive("supported", ["predictable", "insufficient_evidence", "not_predictable"])).toBe(
      "advance",
    );
  });

  it("quarantines a supported analysis with no meanings judged", () => {
    expect(derive("supported", [])).toBe("quarantine");
  });
});

describe("endorsement override", () => {
  const exclude = { disposition: "exclude" as const, reason: "" };
  const quarantine = { disposition: "quarantine" as const, reason: "" };
  const advance = { disposition: "advance" as const, reason: "" };

  it("rescues an endorsed word from a fuzzy morphology exclusion", () => {
    const result = applyEndorsement(exclude, 3);
    expect(result.disposition).toBe("advance");
    expect(result.endorsementOverride).toBe(true);
  });

  it("leaves an unendorsed exclusion alone", () => {
    expect(applyEndorsement(exclude, 0).disposition).toBe("exclude");
  });

  it("does not rescue a quarantine: a study guide supplies no lexical evidence", () => {
    const result = applyEndorsement(quarantine, 6);
    expect(result.disposition).toBe("quarantine");
    expect(result.endorsementOverride).toBe(false);
  });

  it("leaves an advance unchanged", () => {
    expect(applyEndorsement(advance, 9).disposition).toBe("advance");
  });
});

describe("model self-confidence", () => {
  const finding = (confidence: number | null): Finding => ({
    claim_id: "rebut|affix_strip",
    analysis_support: "supported",
    analysis_rationale: "",
    analysis_evidence_ids: [],
    meanings: [
      { sense_ids: ["a"], predictability: "predictable", evidence_ids: [], rationale: "" },
    ],
    diagnostic_confidence: confidence,
  });

  it("never reaches the policy layer", () => {
    // The guarantee is structural: verdictOf is the only way a finding becomes
    // policy input, and it carries two fields. If this assertion ever needs
    // updating, something is being handed to the policy that should not be.
    expect(Object.keys(verdictOf(finding(0.99))).sort()).toEqual([
      "analysisSupport",
      "predictabilities",
    ]);
  });

  it("cannot change the outcome", () => {
    const confident = deriveMorphologyDisposition(verdictOf(finding(1)));
    const doubtful = deriveMorphologyDisposition(verdictOf(finding(0)));
    const absent = deriveMorphologyDisposition(verdictOf(finding(null)));
    expect(confident).toEqual(doubtful);
    expect(confident).toEqual(absent);
  });
});
