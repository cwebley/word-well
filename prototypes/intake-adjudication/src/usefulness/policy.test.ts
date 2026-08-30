import { describe, expect, it } from "vitest";

import { usefulnessGate } from "./gate.ts";
import { deriveHeadwordDisposition, deriveUsefulness } from "./policy.ts";

describe("one meaning's disposition", () => {
  it("advances a meaning worth learning", () => {
    expect(deriveUsefulness("useful").disposition).toBe("advance");
  });

  it("excludes one that is not", () => {
    expect(deriveUsefulness("not_useful").disposition).toBe("exclude");
  });

  it("quarantines rather than guessing when the evidence cannot settle it", () => {
    expect(deriveUsefulness("insufficient_evidence").disposition).toBe("quarantine");
  });
});

describe("folding a headword's meanings", () => {
  it("keeps a polysemous headword on the strength of one useful meaning", () => {
    // The acceptance criterion, and the asymmetry: a wrong admit shows up in the
    // app, a wrong exclude is terminal and silent.
    expect(deriveHeadwordDisposition(["not_useful", "useful", "not_useful"]).disposition).toBe(
      "advance",
    );
  });

  it("does not let an undecided meaning take away a decided useful one", () => {
    expect(deriveHeadwordDisposition(["insufficient_evidence", "useful"]).disposition).toBe(
      "advance",
    );
  });

  it("quarantines when nothing was useful and something could not be judged", () => {
    expect(deriveHeadwordDisposition(["not_useful", "insufficient_evidence"]).disposition).toBe(
      "quarantine",
    );
  });

  it("excludes only when every meaning was judged and none was useful", () => {
    expect(deriveHeadwordDisposition(["not_useful", "not_useful"]).disposition).toBe("exclude");
  });

  it("quarantines a headword whose meanings never came back", () => {
    expect(deriveHeadwordDisposition([]).disposition).toBe("quarantine");
  });
});

describe("what the gate refuses to let through", () => {
  it("applies no policy context, so endorsement cannot override a usefulness verdict", () => {
    // Not an oversight. The retention audit samples endorsed words; a policy that
    // advanced them by rule would make the audit report its own override back as
    // a retention rate.
    expect(usefulnessGate.applyContext).toBeUndefined();
  });

  it("records endorsement for correlation without letting it reach the prompt", () => {
    const subject = {
      candidate: { display: "laconic", pos: ["a"], zipf: 2.39, normalized: "laconic", meaning_count: 1 },
      meaning: {
        sense_id: "oewn-laconic__5.00.00.concise.00",
        pos: "a",
        lemma: "laconic",
        definition: "brief and to the point; effectively cut short",
        examples: [],
        examples_truncated: false,
        synset_members: ["crisp", "curt", "laconic", "terse"],
      },
      subject_id: "laconic|oewn-laconic__5.00.00.concise.00",
      extraction_version: "usefulness-evidence/1",
      input_digest: "x",
      missing_evidence: [],
      policy_context: { endorsements: 137 },
    };

    expect(usefulnessGate.policyContext(subject)).toEqual({ endorsements: 137 });
    const sent = usefulnessGate.buildMessages(subject).map((m) => m.content).join("\n");
    expect(sent).not.toContain("137");
    expect(sent.toLowerCase()).not.toContain("endors");
  });
});
