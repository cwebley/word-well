import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";
import { z } from "zod";
import { digest, PrivateError } from "./storage/crypto.js";

const labels = ["offensive", "slur", "ethnic slur", "ethnic-slur", "vulgar", "derogatory", "pejorative", "taboo", "profanity", "obscene", "coarse", "racially offensive", "homophobic", "transphobic", "misogynistic"];
const aliases = { "ethnic slur": "ethnic-slur", "racial slur": "slur", "religious slur": "slur", pejoratively: "pejorative", "pej.": "pejorative", "derog.": "derogatory", derogative: "derogatory", disparaging: "derogatory", "strong language": "vulgar" };
export const pipelineConfigSchema = z.object({ filters: z.object({
  source_match: z.object({ require_oewn: z.literal(true), ambiguous: z.literal("unresolved") }).strict(),
  frequency: z.object({ dataset: z.literal("wordfreq"), version: z.literal("3.1.1"), language: z.literal("en"), wordlist: z.literal("large"), measure: z.literal("direct_headword"), required_tokens: z.literal(1), ceiling: z.number().min(0).max(3.7), floor: z.null(), missing: z.literal("unresolved") }).strict(),
  prohibited_labels: z.object({ enabled: z.literal(true), scope: z.literal("all_recorded_meanings"), labels: z.array(z.string()), aliases: z.record(z.string(), z.string()) }).strict().superRefine((value, ctx) => {
    if (labels.some(label => !value.labels.includes(label)) || new Set(value.labels).size !== value.labels.length || value.labels.some(label => !labels.includes(label)) || canonical(value.aliases) !== canonical(aliases)) ctx.addIssue({ code: "custom", message: "unsupported_label_policy" });
  }),
  spelling: z.object({ preferred_dialect: z.literal("en-US"), exclude_explicit_nonpreferred: z.literal(true), require_preferred_target: z.literal(true), ambiguous: z.literal("no_exclusion") }).strict(),
  entry_form: z.object({ exclude_only: z.tuple([z.literal("numeral"), z.literal("abbreviation"), z.literal("inflected_form")]), preserve_lexical_entries: z.literal(true) }).strict(),
  speculative: z.object({ affix_transparency: z.literal(false), compound_splitting: z.literal(false), derivation_redundancy: z.literal(false), missing_synonyms: z.literal(false), broad_topic: z.literal(false) }).strict()
}).strict() }).strict();
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

// Stable object-key ordering; source-order arrays remain ordered.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown) => digest(canonical(value));
export async function loadPipelineConfig(path: string): Promise<PipelineConfig> {
  try {
    const document = parseDocument(await readFile(path, "utf8"), { uniqueKeys: true });
    if (document.errors.length) throw new Error();
    return pipelineConfigSchema.parse(document.toJS({ maxAliasCount: 0 }));
  } catch { throw new PrivateError("pipeline_configuration_invalid"); }
}
