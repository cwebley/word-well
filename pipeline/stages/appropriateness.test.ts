// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APPROPRIATENESS_CONFIGURATION, averageDecision, CONFIGURATIONS, createAppropriatenessStage, dispositionFor, thresholdsFor } from "./appropriateness.js";

// Single-question behavior is pinned on the slur-senses wording.
const SINGLE_QUESTION = CONFIGURATIONS["v2"];

const stage = createAppropriatenessStage(SINGLE_QUESTION);

function reply(answer: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    model: "typesafe/jev-1.13-20260917",
    answers: { appropriateness: { type: "choice", ...answer } },
    usage: { input_tokens: 412, output_tokens: 20, cost: 0.000017304 },
    id: "gen-harmless-1", provider: "TypeSafe", ...overrides
  });
}
const clear = { choice: "clear", probabilities: { clear: 0.93, blocked: 0.07 }, confidence: 0.93 };

describe("appropriateness stage request", () => {
  it("sends the exact headword as state with the approved question and nothing else", () => {
    expect(stage.render({ headword: "exuberant" })).toEqual({
      model: "typesafe/jev-1.13",
      state: "exuberant",
      questions: {
        appropriateness: {
          type: "choice",
          instructions:
            "Assess whether this headword is appropriate for WordWell, a General American English vocabulary app for adults.\n\n" +
            "Consider every established sense of the headword, not only its most common one. Choose blocked if any sense is a slur or derogatory term for people based on race, ethnicity, nationality, religion, sex, sexual orientation, gender identity, or disability, even when the headword's main sense is harmless.\n\n" +
            "Also choose blocked if the headword has other offensive or derogatory usage, sexually explicit usage, profanity, or vulgar bodily usage, including a plausible connotation in any of those categories.\n\n" +
            "Neutral medical or anatomical subject matter alone is allowed. Choose clear when no slur sense, prohibited usage, or plausible prohibited connotation is identified.",
          criteria: {
            clear: "No slur sense, prohibited usage, or plausible prohibited connotation identified.",
            blocked: "A slur sense, other prohibited usage, or a plausible prohibited connotation identified."
          }
        }
      }
    });
  });

  it("keeps the headword byte for byte, including case, spacing and accents", () => {
    expect((stage.render({ headword: " Café-au-lait " }) as { state: string }).state).toBe(" Café-au-lait ");
  });

  it("rejects stage input carrying anything besides the headword", () => {
    expect(() => stage.render({ headword: "exuberant", expected: "clear" } as never)).toThrow("stage_input_invalid");
  });
});

describe("appropriateness reply validation", () => {
  it("accepts a valid clear reply and keeps the returned fields", () => {
    expect(stage.validate(reply(clear))).toEqual({ ok: true, result: {
      choice: "clear", probabilities: { clear: 0.93, blocked: 0.07 }, confidence: 0.93,
      blockedProbability: 0.07, finding: "clear", disposition: "accept"
    } });
  });

  it("blocks an exact 0.50 tie whichever choice Jev reports", () => {
    for (const choice of ["clear", "blocked"]) {
      const result = stage.validate(reply({ choice, probabilities: { clear: 0.5, blocked: 0.5 }, confidence: 0.5 }));
      expect(result).toMatchObject({ ok: true, result: { finding: "blocked", disposition: "reject" } });
    }
  });

  it("accepts a choice within one rounding step of the top option", () => {
    const result = stage.validate(reply({ choice: "clear", probabilities: { clear: 0.5, blocked: 0.51 }, confidence: 0.51 }));
    expect(result).toMatchObject({ ok: true, result: { finding: "blocked", disposition: "reject" } });
  });

  it.each([
    ["malformed JSON", "{not json", "malformed_reply"],
    ["a different returned model", reply(clear, { model: "typesafe/jev-1.13-20261001" }), "wrong_model"],
    ["an extra question", JSON.stringify({ ...JSON.parse(reply(clear)), answers: { appropriateness: { type: "choice", ...clear }, other: { type: "noul", noul: 0.1 } } }), "answers_mismatch"],
    ["no answer", JSON.stringify({ ...JSON.parse(reply(clear)), answers: {} }), "answers_mismatch"],
    ["an unknown choice", reply({ ...clear, choice: "sensitive" }), "choice_not_allowed"],
    ["a third option", reply({ ...clear, probabilities: { clear: 0.9, blocked: 0.05, sensitive: 0.05 } }), "distribution_invalid"],
    ["a missing option", reply({ ...clear, probabilities: { clear: 1 } }), "distribution_invalid"],
    ["probabilities summing to 0.98", reply({ ...clear, probabilities: { clear: 0.91, blocked: 0.07 } }), "distribution_invalid"],
    ["a probability above 1", reply({ ...clear, probabilities: { clear: 1.2, blocked: -0.2 } }), "distribution_invalid"],
    ["confidence outside 0..1", reply({ ...clear, confidence: 1.5 }), "confidence_invalid"],
    ["a choice contradicting the probabilities", reply({ ...clear, choice: "blocked" }), "choice_inconsistent"],
    ["a provider error inside HTTP 200", JSON.stringify({ error: { code: 502, message: "upstream" } }), "provider_error"]
  ])("rejects %s with no verdict", (_name, raw, code) => {
    expect(stage.validate(raw)).toEqual({ ok: false, code });
  });

  it("allows a sum within the two-decimal rounding tolerance", () => {
    expect(stage.validate(reply({ ...clear, probabilities: { clear: 0.94, blocked: 0.07 } }))).toMatchObject({ ok: true });
  });
});

describe("appropriateness policy", () => {
  it("blocks at 0.50 and above and clears below", () => {
    expect(dispositionFor(0.5)).toBe("reject");
    expect(dispositionFor(0.4999)).toBe("accept");
  });

  it("averages three valid trials before applying the threshold, without rounding", () => {
    const b = (blocked: number) => ({ blocked, slur: null });
    expect(averageDecision([b(0.49), b(0.49), b(0.99)])).toEqual({ blockedProbability: (0.49 + 0.49 + 0.99) / 3, slurProbability: null, vulgarProbability: null, disposition: "reject" });
    expect(averageDecision([b(0.5), b(0.5), b(0.49)])).toMatchObject({ disposition: "accept" });
    expect(averageDecision([b(0.5), b(0.5), b(0.5)])).toMatchObject({ disposition: "reject" });
  });

  it("gives no verdict unless all three trials are valid", () => {
    expect(averageDecision([{ blocked: 0.1, slur: null }, { blocked: 0.1, slur: null }])).toBeNull();
    expect(averageDecision([{ blocked: 0.1, slur: null }, { blocked: 0.1, slur: null }, null])).toBeNull();
  });
});

describe("configuration identity", () => {
  it("changes when the model, question or policy changes", () => {
    const fingerprint = stage.fingerprint;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(createAppropriatenessStage({ ...SINGLE_QUESTION, pinnedModel: "typesafe/jev-1.14-20270101" }).fingerprint).not.toBe(fingerprint);
    expect(createAppropriatenessStage(structuredClone(SINGLE_QUESTION)).fingerprint).toBe(fingerprint);
  });
});

describe("slur-sense question configurations", () => {
  const twoQuestion = createAppropriatenessStage(CONFIGURATIONS["v3"]);
  const both = (blocked: number, slur: number, overrides: Record<string, unknown> = {}) => JSON.stringify({
    model: "typesafe/jev-1.13-20260917",
    answers: {
      appropriateness: { type: "choice", choice: blocked >= 0.5 ? "blocked" : "clear", probabilities: { clear: Math.round((1 - blocked) * 100) / 100, blocked }, confidence: 0.9 },
      slur_sense: { type: "noul", noul: slur }
    },
    usage: { input_tokens: 600, output_tokens: 30, cost: 0.0000252 }, id: "gen-harmless-2", provider: "TypeSafe", ...overrides
  });

  it("sends both questions with the exact headword", () => {
    const body = twoQuestion.render({ headword: "exuberant" }) as { state: string; questions: Record<string, { type: string; instructions: string }> };
    expect(body.state).toBe("exuberant");
    expect(Object.keys(body.questions)).toEqual(["appropriateness", "slur_sense"]);
    expect(body.questions.slur_sense.type).toBe("noul");
    expect(body.questions.slur_sense.instructions).toContain("slur");
  });

  it("rejects a trial when either question reaches 0.50", () => {
    expect(twoQuestion.validate(both(0.47, 0.81))).toMatchObject({ ok: true, result: { blockedProbability: 0.47, slurProbability: 0.81, finding: "blocked", disposition: "reject" } });
    expect(twoQuestion.validate(both(0.47, 0.5))).toMatchObject({ ok: true, result: { disposition: "reject" } });
    expect(twoQuestion.validate(both(0.1, 0.2))).toMatchObject({ ok: true, result: { slurProbability: 0.2, disposition: "accept" } });
  });

  it("averages each question separately before applying the threshold", () => {
    // Blocked mean 0.49 and slur mean 0.4966… both stay below 0.50.
    expect(averageDecision([{ blocked: 0.47, slur: 0.49 }, { blocked: 0.49, slur: 0.5 }, { blocked: 0.51, slur: 0.5 }]))
      .toMatchObject({ disposition: "accept" });
    expect(averageDecision([{ blocked: 0.1, slur: 0.6 }, { blocked: 0.1, slur: 0.5 }, { blocked: 0.1, slur: 0.4 }]))
      .toEqual({ blockedProbability: expect.closeTo(0.1, 12), slurProbability: expect.closeTo(0.5, 12), vulgarProbability: null, disposition: "reject" });
  });

  it.each([
    ["a missing slur answer", JSON.stringify({ ...JSON.parse(both(0.1, 0.1)), answers: { appropriateness: JSON.parse(both(0.1, 0.1)).answers.appropriateness } }), "answers_mismatch"],
    ["a slur probability above 1", both(0.1, 1.2), "noul_invalid"],
    ["a slur answer of the wrong type", JSON.stringify({ ...JSON.parse(both(0.1, 0.1)), answers: { ...JSON.parse(both(0.1, 0.1)).answers, slur_sense: { type: "choice" } } }), "noul_invalid"]
  ])("rejects %s with no verdict", (_name, raw, code) => {
    expect(twoQuestion.validate(raw)).toEqual({ ok: false, code });
  });

  it("keeps single-question configurations byte-for-byte compatible", () => {
    // Fingerprints of configurations that saved experiments already reference.
    const fingerprint = (name: string) => createAppropriatenessStage(CONFIGURATIONS[name]).fingerprint.slice(0, 12);
    expect(Object.fromEntries(Object.keys(CONFIGURATIONS).map(name => [name, fingerprint(name)]))).toEqual({
      "v1": "26950a69eecf", "v2": "662c89e4212f", "v3": "bec7bdaccdf5", "v4": "a0a0c4bfcef7",
      "v1-slur-check": "b53ca604e46b", "v3-lookalike": "2ccf13843db5", "v4-vulgar-check": "42ef96d5ab62"
    });
    expect(createAppropriatenessStage(APPROPRIATENESS_CONFIGURATION).fingerprint).toBe(createAppropriatenessStage(CONFIGURATIONS["v4"]).fingerprint);
    expect(createAppropriatenessStage(CONFIGURATIONS["v2"]).validate(both(0.1, 0.1))).toEqual({ ok: false, code: "answers_mismatch" });
    expect(new Set(Object.values(CONFIGURATIONS).map(c => createAppropriatenessStage(c).fingerprint)).size).toBe(7);
    const lookalike = (createAppropriatenessStage(CONFIGURATIONS["v3-lookalike"]).render({ headword: "x" }) as { questions: Record<string, { instructions: string }> }).questions;
    expect(lookalike.appropriateness.instructions).toContain("not the spelling or sound of its parts");
    expect(Object.keys(lookalike)).toEqual(["appropriateness", "slur_sense"]);
  });
});

describe("genital exemption, slur threshold 0.40 and vulgar-sense question", () => {
  const config = CONFIGURATIONS["v4-vulgar-check"];
  const stage = createAppropriatenessStage(config);
  const reply = (blocked: number, slur: number, vulgar: number) => JSON.stringify({
    model: "typesafe/jev-1.13-20260917",
    answers: {
      appropriateness: { type: "choice", choice: blocked >= 0.5 ? "blocked" : "clear", probabilities: { clear: Math.round((1 - blocked) * 100) / 100, blocked }, confidence: 0.9 },
      slur_sense: { type: "noul", noul: slur },
      vulgar_sense: { type: "noul", noul: vulgar }
    },
    usage: { input_tokens: 800, output_tokens: 40, cost: 0.0000336 }, id: "gen-harmless-3", provider: "TypeSafe"
  });

  it("narrows the anatomical exemption and asks all three questions", () => {
    const body = stage.render({ headword: "clavicle" }) as { questions: Record<string, { instructions: string }> };
    expect(Object.keys(body.questions)).toEqual(["appropriateness", "slur_sense", "vulgar_sense"]);
    expect(body.questions.appropriateness.instructions).toContain("Neutral medical or anatomical subject matter is allowed, except terms for genitals or sexual acts.");
    expect(body.questions.appropriateness.instructions).not.toContain("subject matter alone is allowed");
    expect(body.questions.vulgar_sense.instructions).toContain("sexual, vulgar bodily, or profane slang meaning");
  });

  it("rejects at slur 0.40 and vulgar 0.50, and keeps the main question at 0.50", () => {
    expect(stage.validate(reply(0.37, 0.44, 0.1))).toMatchObject({ ok: true, result: { slurProbability: 0.44, vulgarProbability: 0.1, disposition: "reject" } });
    expect(stage.validate(reply(0.37, 0.39, 0.1))).toMatchObject({ ok: true, result: { disposition: "accept" } });
    expect(stage.validate(reply(0.13, 0.12, 0.5))).toMatchObject({ ok: true, result: { vulgarProbability: 0.5, finding: "blocked", disposition: "reject" } });
    expect(stage.validate(reply(0.49, 0.1, 0.49))).toMatchObject({ ok: true, result: { disposition: "accept" } });
  });

  it("averages each question and applies its own threshold", () => {
    const thresholds = thresholdsFor(config);
    expect(thresholds).toEqual({ blocked: 0.5, slur: 0.4, vulgar: 0.5 });
    expect(averageDecision([{ blocked: 0.37, slur: 0.44, vulgar: 0.1 }, { blocked: 0.35, slur: 0.49, vulgar: 0.1 }, { blocked: 0.4, slur: 0.52, vulgar: 0.1 }], thresholds))
      .toMatchObject({ disposition: "reject" });
    expect(averageDecision([{ blocked: 0.37, slur: 0.44, vulgar: 0.1 }, { blocked: 0.35, slur: 0.49, vulgar: 0.1 }, { blocked: 0.4, slur: 0.52, vulgar: 0.1 }]))
      .toMatchObject({ disposition: "accept" });
  });

  it("rejects a reply missing the vulgar answer", () => {
    const missing = JSON.parse(reply(0.1, 0.1, 0.1));
    delete missing.answers.vulgar_sense;
    expect(stage.validate(JSON.stringify(missing))).toEqual({ ok: false, code: "answers_mismatch" });
  });
});

describe("genital exemption with slur threshold 0.40, no vulgar question", () => {
  it("asks two questions and keeps the narrowed exemption and slur threshold", () => {
    const config = CONFIGURATIONS["v4"];
    const body = createAppropriatenessStage(config).render({ headword: "x" }) as { questions: Record<string, { instructions: string }> };
    expect(Object.keys(body.questions)).toEqual(["appropriateness", "slur_sense"]);
    expect(body.questions.appropriateness.instructions).toContain("except terms for genitals or sexual acts");
    expect(thresholdsFor(config)).toEqual({ blocked: 0.5, slur: 0.4, vulgar: 0.5 });
  });
});
