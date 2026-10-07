import type { PipelineConfig } from "./config.js";
import type { EvidenceBundle } from "./sources/bundle.js";
import { z } from "zod";

export const MATCH_VERSION = "nfc-lowercase-inflection-v1";
const normalize = (text: string) => text.normalize("NFC").toLowerCase();
export type MatchEntry = { id: string; headword: string; forms: string[] };
export function resolveForm(form: string, entries: MatchEntry[]) {
  const exact = entries.filter(e => e.headword === form);
  const folded = entries.filter(e => normalize(e.headword) === normalize(form));
  const inflected = entries.filter(e => e.forms.some(f => normalize(f) === normalize(form)));
  const matches = exact.length ? exact : folded.length ? folded : inflected;
  const headwords = [...new Set(matches.map(e => e.headword))];
  return { form, version: MATCH_VERSION, method: exact.length ? "exact" : folded.length ? "case_normalized" : "inflection",
    status: headwords.length === 1 ? "resolved" : headwords.length ? "ambiguous" : "unmatched",
    headword: headwords.length === 1 ? headwords[0] : null, possibilities: headwords, entryIds: matches.map(e => e.id) };
}

const meaningSchema = z.object({ tags: z.array(z.string()).default([]), raw_glosses: z.array(z.string()).default([]), glosses: z.array(z.string()),
  form_of: z.array(z.object({ word: z.string() }).passthrough()).optional(), alt_of: z.array(z.object({ word: z.string() }).passthrough()).optional(),
  examples: z.array(z.object({ text: z.string(), type: z.string().optional(), ref: z.string().optional() }).passthrough()).default([])
}).passthrough();
const entrySchema = z.object({ word: z.string(), pos: z.string(), tags: z.array(z.string()).default([]), senses: z.array(meaningSchema) }).passthrough();
export type LabelEvidence = { value: string; ref: string; kind: "normalized_tag" | "raw_qualifier" | "topic" };
export type SpellingEvidence = { target: string; preferredDialect: string; nonpreferred: boolean; ref: string };
export type FilterInput = {
  resolution: ReturnType<typeof resolveForm>; sourceRefs: string[];
  frequency: EvidenceBundle["frequency"] | null; labels: LabelEvidence[];
  entries: { ref: string; pos: string; tags: string[]; meanings: { ref: string; tags: string[]; inflected: boolean }[] }[];
  spelling: SpellingEvidence[]; spellingVerified: boolean; spellingSourceRefs?: string[]; labelsVerified: boolean;
};
export type RuleOutcome = { rule: string; version: string; outcome: "pass" | "exclude" | "unresolved"; reason: string; evidence: string[]; detail?: unknown };

export function evaluateFilters(input: FilterInput, config: PipelineConfig) {
  const rules: RuleOutcome[] = [];
  const add = (rule: string, outcome: RuleOutcome["outcome"], reason: string, evidence: string[], detail?: unknown) => rules.push({ rule, version: "v1", outcome, reason, evidence, ...(detail === undefined ? {} : { detail }) });
  add("source_match", input.resolution.status === "resolved" ? "pass" : "unresolved", input.resolution.status, input.sourceRefs, input.resolution);
  const frequency = input.frequency;
  if (!frequency || frequency.directZipf === null) add("frequency", "unresolved", "missing_frequency", [], frequency);
  else if (frequency.tokens.length !== config.filters.frequency.required_tokens || frequency.form !== input.resolution.headword) add("frequency", "unresolved", "not_direct_single_token_headword", ["frequency:" + frequency.order], frequency);
  else add("frequency", frequency.directZipf > config.filters.frequency.ceiling ? "exclude" : "pass", "direct_headword_ceiling", ["frequency:" + frequency.order], { ...frequency, ceiling: config.filters.frequency.ceiling, band: frequency.directZipf < 2.03 ? "challenge" : frequency.directZipf < 2.85 ? "stretch" : "foundations" });
  const blocked = input.labels.flatMap(label => {
    const token = label.value.trim().toLowerCase();
    const mapped = config.filters.prohibited_labels.aliases[token] ?? token;
    return config.filters.prohibited_labels.labels.includes(mapped) ? [{ ...label, normalized: token, matched: mapped }] : [];
  });
  add("prohibited_labels", blocked.length ? "exclude" : input.labelsVerified ? "pass" : "unresolved", blocked.length ? "prohibited_label" : input.labelsVerified ? "all_recorded_meanings_scanned" : "label_coverage_missing", blocked.length ? blocked.map(l => l.ref) : input.entries.flatMap(e => e.meanings.map(m => m.ref)), { scanned: input.labels, matches: blocked });
  const preference = input.spelling.filter(s => s.nonpreferred && s.preferredDialect === config.filters.spelling.preferred_dialect);
  const targets = [...new Set(preference.map(s => s.target))];
  const nonlexical = (entry: FilterInput["entries"][number], m: FilterInput["entries"][number]["meanings"][number]) => {
    const tags = [...entry.tags, ...m.tags];
    if (entry.pos === "num" || tags.includes("numeral")) return "numeral";
    if (entry.pos === "abbrev" || tags.some(t => ["abbreviation", "acronym", "initialism"].includes(t))) return "abbreviation";
    return m.inflected ? "inflected_form" : null;
  };
  const classified = input.entries.flatMap(e => e.meanings.map(m => ({ ref: m.ref, classification: nonlexical(e, m) })));
  add("entry_form", !classified.length ? "unresolved" : classified.every(m => m.classification) ? "exclude" : "pass", !classified.length ? "entry_classification_missing" : classified.every(m => m.classification) ? "nonlexical_only" : "lexical_meaning_retained", classified.map(m => m.ref), classified);
  add("spelling", !input.spellingVerified ? "unresolved" : targets.length === 1 && preference.length === input.spelling.length ? "exclude" : "pass", !input.spellingVerified ? "preferred_spelling_mapping_missing" : targets.length === 1 && preference.length === input.spelling.length ? "explicit_preferred_target" : targets.length ? "conflicting_preference_no_exclusion" : "no_explicit_nonpreferred_spelling", [...input.spelling.map(s => s.ref), ...(input.spellingSourceRefs ?? [])], input.spelling);
  return { disposition: rules.some(r => r.outcome === "exclude") ? "exclude" as const : rules.some(r => r.outcome === "unresolved") ? "unresolved" as const : "pass" as const, rules };
}

export function bundleFilterInput(bundle: EvidenceBundle): FilterInput {
  const headword = bundle.coverage.candidates[0];
  const candidateEntries = bundle.entries.filter(e => e.role === "candidate" && e.headword === headword);
  const entries = candidateEntries.filter(e => e.source === "kaikki").map(e => ({ ref: `kaikki:${e.id}`, entry: entrySchema.parse(e.data) }));
  const primary = candidateEntries.filter(e => e.source === "oewn");
  const resolution = resolveForm(bundle.frequency.form, primary.map(e => ({ id: e.id, headword: e.headword,
    forms: z.array(z.object({ writtenForm: z.string() }).passthrough()).parse(e.data.forms).map(f => f.writtenForm) })));
  const labels: LabelEvidence[] = [];
  for (const { entry, ref } of entries) {
    for (const value of entry.tags) labels.push({ value, ref, kind: "normalized_tag" });
    for (const value of z.array(z.string()).parse(entry.topics ?? [])) labels.push({ value, ref, kind: "topic" });
    for (const [i, meaning] of entry.senses.entries()) {
      for (const value of meaning.tags) labels.push({ value, ref: `${ref}:meaning:${i + 1}`, kind: "normalized_tag" });
      for (const value of z.array(z.string()).parse(meaning.topics ?? [])) labels.push({ value, ref: `${ref}:meaning:${i + 1}`, kind: "topic" });
      // Each raw gloss path may include inherited parent qualifiers. Full tokens,
      // including negations, are kept. Definition prose is never label evidence.
      for (const gloss of meaning.raw_glosses) {
        const qualifier = /^\(([^)]+)\)/.exec(gloss)?.[1];
        if (qualifier) for (const value of qualifier.split(/,\s*/)) labels.push({ value, ref: `${ref}:meaning:${i + 1}:raw_gloss`, kind: "raw_qualifier" });
      }
    }
  }
  for (const [i, m] of bundle.supplemental.meanings.entries()) for (const qualifier of m.qualifiers) for (const value of qualifier.labels) labels.push({ value,
    ref: `supplemental:${bundle.supplemental.page_id}:${bundle.supplemental.revision_id}:meaning:${i + 1}`, kind: "raw_qualifier" });
  return { resolution, sourceRefs: primary.map(e => `oewn:${e.id}`), frequency: bundle.frequency, labels,
    labelsVerified: bundle.coverage.kaikkiMeanings === entries.reduce((n, e) => n + e.entry.senses.length, 0),
    entries: entries.map(({ entry, ref }) => ({ ref, pos: entry.pos, tags: entry.tags, meanings: entry.senses.map((m, i) => ({ ref: `${ref}:meaning:${i + 1}`, tags: m.tags, inflected: !!m.form_of?.length })) })),
    // Complete source records were inspected for explicit spelling claims.
    // Empty evidence is authorized only for those exact reviewed bytes.
    spelling: [], spellingVerified: spellingReviewMatches(bundle),
    spellingSourceRefs: [...entries.map(e => e.ref), `supplemental:${bundle.supplemental.page_id}:${bundle.supplemental.revision_id}`] };
}

const spellingReviews = {
  emulate: { pageSha256: "02467344b0af9e5085e9980648e09cd6326f42480affb9e77146686ec7584551", records: [
    ["line:34324", "603e2ee324cf6dfb5463eac28a1f60bc11864ecb3130cde000e56f4f19296cdd"],
    ["line:34325", "cb11f3248c28e0f72b574309e4101f300068427a5f036557861dcc4e17940129"]] },
  evanescent: { pageSha256: "eac73dd56ee2ce1f6845930c7a842ab8859457462e7dd5c98c47569f1138b8d2", records: [
    ["line:242376", "5ab5d9b480e60b88942d232ab081eccba1ed295e6d91108a3449ae0d6f42d455"]] }
};
function spellingReviewMatches(bundle: EvidenceBundle) {
  const headword = bundle.coverage.candidates[0], review = spellingReviews[headword];
  const entries = bundle.entries.filter(e => e.source === "kaikki");
  return bundle.supplemental.text_sha256 === review.pageSha256 && entries.length === review.records.length &&
    entries.every((e, i) => e.role === "candidate" && e.headword === headword && e.id === review.records[i][0] && e.rawSha256 === review.records[i][1]);
}

// A deliberate allowlist for later generation. Whole records and quotations
// remain in source storage; no Wiktionary examples enter this projection.
export function generationEvidence(bundle: EvidenceBundle) {
  const headword = bundle.coverage.candidates[0];
  const primary = new Set(bundle.entries.filter(e => e.source === "oewn" && e.role === "candidate" && e.headword === headword).map(e => e.id));
  return { meanings: bundle.meanings.filter(m => m.source === "oewn" && primary.has(m.entryId)).map(m => ({ id: m.id, conceptId: m.conceptId, order: m.order, definition: m.data.definition, examples: m.data.examples })),
    relations: bundle.relations, pronunciation: bundle.entries.filter(e => e.source === "kaikki").map(e => ({ ref: e.id, sounds: e.data.sounds })),
    etymology: bundle.entries.filter(e => e.source === "kaikki").map(e => ({ ref: e.id, text: e.data.etymology_text, templates: e.data.etymology_templates })) };
}
