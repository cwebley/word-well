// @vitest-environment node
import { describe, it, expect } from "vitest";
import { loadPipelineConfig, pipelineConfigSchema } from "./config.js";
import { evaluateFilters, resolveForm, type FilterInput } from "./intake.js";

const config = await loadPipelineConfig("config/pipeline.yaml");
function input(): FilterInput {
  return { resolution: resolveForm("fixture", [{ id: "entry-fixture", headword: "fixture", forms: ["fixtures"] }]), sourceRefs: ["entry-fixture"],
    frequency: { form: "fixture", order: 1, tokens: ["fixture"], directZipf: 3.7, storedFrequency: 0.000005 },
    labels: [], labelsVerified: true, spelling: [], spellingVerified: true,
    entries: [{ ref: "entry-fixture", pos: "noun", tags: [], meanings: [{ ref: "meaning-1", tags: [], inflected: false }] }] };
}
describe("source-backed intake", () => {
  it("prefers exact lexical entries and never adds bend meanings to bent", () => {
    const entries = [{ id: "bent-a", headword: "bent", forms: [] }, { id: "bend-v", headword: "bend", forms: ["bent"] }];
    expect(resolveForm("bent", entries)).toMatchObject({ status: "resolved", headword: "bent", method: "exact", entryIds: ["bent-a"] });
    expect(resolveForm("BENT", entries)).toMatchObject({ headword: "bent", method: "case_normalized", entryIds: ["bent-a"] });
    expect(resolveForm("bent", entries.slice(1))).toMatchObject({ headword: "bend", method: "inflection" });
  });
  it("retains case and inflection ambiguity without stripping accents or punctuation", () => {
    expect(resolveForm("MIX", [{ id: "1", headword: "mix", forms: [] }, { id: "2", headword: "Mix", forms: [] }])).toMatchObject({ status: "ambiguous", possibilities: ["mix", "Mix"] });
    expect(resolveForm("fixtures", [{ id: "1", headword: "fixture", forms: ["fixtures"] }, { id: "2", headword: "Fixture", forms: ["fixtures"] }]).status).toBe("ambiguous");
    expect(resolveForm("cafe", [{ id: "1", headword: "café", forms: [] }]).status).toBe("unmatched");
  });
  it("uses the direct frequency boundary and keeps missing and multi-token scores unresolved", () => {
    const value = input();
    expect(evaluateFilters(value, config).disposition).toBe("pass");
    value.frequency!.directZipf = 3.71;
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "frequency")?.outcome).toBe("exclude");
    value.frequency!.directZipf = 0.01;
    expect(evaluateFilters(value, config).disposition).toBe("pass");
    value.frequency!.tokens = ["fix", "ture"];
    expect(evaluateFilters(value, config).disposition).toBe("unresolved");
    value.frequency = null;
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "frequency")?.reason).toBe("missing_frequency");
  });
  it("matches full label tokens and aliases, preserves inherited evidence and negation", () => {
    const value = input();
    value.labels = [{ value: "not offensive", ref: "parent-1", kind: "raw_qualifier" }, { value: "medicine", ref: "meaning-1", kind: "normalized_tag" }, { value: "sexual", ref: "meaning-1", kind: "normalized_tag" }];
    expect(evaluateFilters(value, config).disposition).toBe("pass");
    value.labels.push({ value: "  Pej.  ", ref: "parent-2:child-1", kind: "normalized_tag" });
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "prohibited_labels")).toMatchObject({ outcome: "exclude", evidence: ["parent-2:child-1"] });
    value.labels = []; value.labelsVerified = false;
    expect(evaluateFilters(value, config).disposition).toBe("unresolved");
  });
  it("preserves lexical meanings alongside numeral, abbreviation and inflected entries", () => {
    const value = input();
    value.entries.push({ ref: "numeral-mix", pos: "num", tags: [], meanings: [{ ref: "numeral-1", tags: [], inflected: false }] });
    expect(evaluateFilters(value, config).disposition).toBe("pass");
    value.entries = value.entries.slice(1);
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "entry_form")?.reason).toBe("nonlexical_only");
    value.entries[0].pos = "noun"; value.entries[0].meanings[0].inflected = true;
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "entry_form")?.outcome).toBe("exclude");
    value.entries[0].meanings[0] = { ref: "abbreviation-1", tags: ["abbreviation"], inflected: false };
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "entry_form")?.outcome).toBe("exclude");
  });
  it("requires explicit preferred targets and never excludes generic alternative forms", () => {
    const value = input();
    value.entries[0].meanings[0].tags = ["British", "alternative"];
    expect(evaluateFilters(value, config).disposition).toBe("pass");
    value.spelling = [{ target: "fixture", preferredDialect: "en-US", nonpreferred: true, ref: "explicit-spelling-1" }];
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "spelling")).toMatchObject({ outcome: "exclude", evidence: ["explicit-spelling-1"] });
    value.spelling.push({ target: "fixtures", preferredDialect: "en-US", nonpreferred: true, ref: "conflict-2" });
    expect(evaluateFilters(value, config).rules.find(r => r.rule === "spelling")?.outcome).toBe("pass");
  });
  it("rejects unknown settings, speculative filters and disabled required policy", () => {
    expect(pipelineConfigSchema.safeParse({ ...config, unsupported: true }).success).toBe(false);
    expect(pipelineConfigSchema.safeParse({ filters: { ...config.filters, speculative: { ...config.filters.speculative, missing_synonyms: true } } }).success).toBe(false);
    expect(pipelineConfigSchema.safeParse({ filters: { ...config.filters, prohibited_labels: { ...config.filters.prohibited_labels, enabled: false } } }).success).toBe(false);
    expect(pipelineConfigSchema.safeParse({ filters: { ...config.filters, frequency: { ...config.filters.frequency, ceiling: 3.8 } } }).success).toBe(false);
  });
});
