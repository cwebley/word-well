import { describe, expect, it } from "vitest";

import { audienceRiskDisposition } from "./audience-risk-v15.ts";

const finding = (audience_risk: "clear" | "sensitive" | "blocked") => ({
  headword: "example",
  familiarity: "less_common" as const,
  audience_risk,
  rationale: "test",
});

describe("audience-risk policy", () => {
  it("advances clear findings", () => {
    expect(audienceRiskDisposition(finding("clear")).disposition).toBe("advance");
  });

  it("excludes sensitive findings instead of quarantining them", () => {
    expect(audienceRiskDisposition(finding("sensitive")).disposition).toBe("exclude");
  });

  it("excludes blocked findings", () => {
    expect(audienceRiskDisposition(finding("blocked")).disposition).toBe("exclude");
  });
});
