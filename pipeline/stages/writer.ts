import { z } from "zod";
import { fingerprint } from "../config.js";
import { PrivateError } from "../storage/crypto.js";
import type { StageDefinition } from "../execution/stage.js";
import { checkPlan, planSchema, plannerInputSchema, type LessonPlan, type PlannerInput } from "./planner.js";
import { checkLunaRouting, completionBody, lunaExchangeSchema } from "../execution/luna-response.js";

// Approved prototype instructions, with the approved example and source-note amendments.
export const WRITER_PROMPT = `You are writing a vocabulary lesson for an adult learner.

The meanings and their definitions are already decided. For each one, write:

- three example sentences using the headword: one demonstrates the meaning directly, one shows a natural figurative use when supported, and the third is chosen for teaching value. Plausible creative analogies count. If a figurative use would be forced, use another direct example instead. A creative analogy does not establish a separate meaning or claim attested usage. Use distinct situations across the three examples. Make the context show what the headword describes and why it fits. For a natural figurative application, prefer a clear event or consequence. Avoid repeating the same image across a comparison.
- situation: when the word fits, in one sentence starting with a gerund, such as "Describing a room that is bare and undecorated"
- not_for: what it would be wrong for, same form. Describe a use that conflicts with the planned meaning. Do not turn a typical association or tendency into an absolute restriction.
- common patterns: short phrases containing the headword, not prose
- usage_notes: one sentence for each supplied usage-note sense, saying what the extended use is. Return its source_ref and text. Empty when none are supplied.
- origin_note: one sentence, ONLY when the supplied origin explains or warns about how the word is used today. Null when the origin merely restates the definition. Use only the origin supplied for that meaning.
- for each supplied synonym, what it carries MORE of and LESS of than the headword. Compare the supplied synonym definition with the headword definition. Name only differences those definitions support. Do not infer planning, a fixed deadline, suddenness, or register from the word alone. Do not restate the synonym's definition as its MORE quality. Return null for any side without a clear supported difference. Both sides null when the two words are near-equivalent. Each non-null side must contain one to three words, naming a specific quality that helps a learner choose between the synonym and the headword in context. Make each side understandable on its own.

Put no example sentences in situation or not_for. The examples have their own field.`;

const text = z.string().min(1).refine(value => Boolean(value.trim()));
export const normalizeSourceText = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function writerMeaningEvidence(input: PlannerInput, planned: LessonPlan["meanings"][number]) {
  return { examples: planned.sense_ids.flatMap(ref => input.meanings.find(s => s.ref === ref)!.examples.map(text => ({ source_ref: ref, text }))),
    usageNotes: planned.usage_note_sense_ids.map(ref => ({ source_ref: ref, definition: input.meanings.find(s => s.ref === ref)!.definition })) };
}
export function writerContrastSourceIds(input: PlannerInput, planned: LessonPlan["meanings"][number], synonym: string) {
  return [...new Set(planned.sense_ids.flatMap(ref => input.meanings.find(s => s.ref === ref)!.contrasts
    .filter(c => c.word === synonym).map(c => c.support.to)))];
}
const originSchema = z.object({ source_ref: text, entryId: text, rawSha256: z.string().regex(/^[a-f0-9]{64}$/), text }).strict();
export const writerInputSchema = z.object({ headword: text.max(200), bundleId: z.string().regex(/^[a-f0-9]{64}$/),
  plannerInput: plannerInputSchema, plan: planSchema,
  excludedQuotations: z.array(z.object({ source_ref: text, text }).strict()),
  meanings: z.array(z.object({ ref: z.string().regex(/^m[1-9][0-9]*$/), definition: text,
    partOfSpeech: z.enum(["noun", "verb", "adjective", "adverb"]), synonyms: z.array(text),
    // Absent only in historical names-only inputs. Current mode requires exact coverage.
    contrastDefinitions: z.array(z.object({ synonym: text, definitions: z.array(z.object({ sourceId: text, definition: text }).strict()).min(1) }).strict()).optional(),
    examples: z.array(z.object({ source_ref: text, text }).strict()),
    usageNotes: z.array(z.object({ source_ref: text, definition: text }).strict()),
    origin: originSchema.nullable(), originAbsence: text.nullable()
  }).strict()).min(1)
}).strict().superRefine((input, ctx) => {
  try {
    const plan = checkPlan(input.plannerInput, input.plan);
    if (input.headword !== input.plannerInput.headword || input.bundleId !== input.plannerInput.bundleId || input.meanings.length !== plan.meanings.length)
      throw new PrivateError("writer_plan_mismatch");
    for (const [index, meaning] of input.meanings.entries()) {
      const planned = plan.meanings[index];
      const evidence = writerMeaningEvidence(input.plannerInput, planned);
      if (meaning.ref !== `m${index + 1}` || meaning.definition !== planned.definition || meaning.partOfSpeech !== planned.part_of_speech ||
        fingerprint(meaning.synonyms) !== fingerprint(planned.synonyms) || fingerprint(meaning.examples) !== fingerprint(evidence.examples) ||
        fingerprint(meaning.usageNotes) !== fingerprint(evidence.usageNotes) || (meaning.origin === null) !== (meaning.originAbsence !== null))
        throw new PrivateError("writer_plan_mismatch");
      if (meaning.contrastDefinitions !== undefined) {
        const terms = meaning.contrastDefinitions.map(c => c.synonym);
        if (terms.length !== planned.synonyms.length || new Set(terms).size !== terms.length || terms.some(term => !planned.synonyms.includes(term)))
          throw new PrivateError("writer_contrast_evidence_invalid");
        for (const contrast of meaning.contrastDefinitions) {
          const supportedIds = new Set(writerContrastSourceIds(input.plannerInput, planned, contrast.synonym));
          const ids = contrast.definitions.map(d => d.sourceId);
          if (new Set(ids).size !== ids.length || ids.length !== supportedIds.size || ids.some(id => !supportedIds.has(id)))
            throw new PrivateError("writer_contrast_evidence_invalid");
        }
      }
    }
  } catch { ctx.addIssue({ code: "custom", message: "writer_plan_mismatch" }); }
});
export type WriterInput = z.infer<typeof writerInputSchema>;
// Keep provider schema constraints structural. Input-bound checks run after parsing.
export const writerResultSchema = z.object({ meanings: z.array(z.object({ meaning_id: z.string(), examples: z.array(z.string()),
  situation: z.string(), not_for: z.string(), common_patterns: z.array(z.string()),
  synonyms: z.array(z.object({ synonym: z.string(), more: z.string().nullable(), less: z.string().nullable() }).strict()),
  usage_notes: z.array(z.object({ source_ref: z.string(), text: z.string() }).strict()), origin_note: z.string().nullable()
}).strict()) }).strict();
export type WrittenLesson = z.infer<typeof writerResultSchema>;
const historicalWriterConfigurationSchema = z.object({ schema: z.literal("wordwell-writer-configuration-v1"), stage: z.literal("writer"),
  route: z.literal("openrouter-aisdk-v1"), requestedModel: z.literal("openai/gpt-5.6-luna"), pinnedModel: z.literal("openai/gpt-5.6-luna-20260709"),
  provider: z.literal("openai"), maxOutputTokens: z.number().int().min(64).max(16000), prompt: text,
  contrastEvidence: z.literal("selected-definitions-v1").optional(),
  routingVerification: z.literal("authenticated-generation-resumable-v1"), metadataRecovery: z.literal("saved-completion-append-only-rounds-v1"),
  routingLookup: z.object({ maxAttempts: z.literal(6), maxWaitMs: z.literal(30000), delaysMs: z.tuple([z.literal(1000), z.literal(2000), z.literal(4000), z.literal(8000), z.literal(8000)]) }).strict()
}).strict();
export const writerConfigurationSchema = z.union([historicalWriterConfigurationSchema,
  historicalWriterConfigurationSchema.omit({ routingLookup: true, metadataRecovery: true }).extend({ schema: z.literal("wordwell-writer-configuration-v2"),
    routingVerification: z.literal("completion-inline-strict-v1"), responseCache: z.literal("disabled"), missingEvidence: z.literal("terminal-verification-unresolved") }).strict()]);
export type WriterConfiguration = z.infer<typeof writerConfigurationSchema>;
export const WRITER_CONFIGURATION: WriterConfiguration = { schema: "wordwell-writer-configuration-v2", stage: "writer", route: "openrouter-aisdk-v1",
  requestedModel: "openai/gpt-5.6-luna", pinnedModel: "openai/gpt-5.6-luna-20260709", provider: "openai", maxOutputTokens: 16000, prompt: WRITER_PROMPT,
  contrastEvidence: "selected-definitions-v1",
  routingVerification: "completion-inline-strict-v1", responseCache: "disabled", missingEvidence: "terminal-verification-unresolved" };

export function writerPayload(input: WriterInput, contrastEvidence?: WriterConfiguration["contrastEvidence"]) {
  return `headword: ${input.headword}\n\n` + input.meanings.map(m => `${m.ref} [${m.partOfSpeech}] ${m.definition}\n` +
    `    synonyms: ${m.synonyms.join(", ") || "none"}\n` +
    (contrastEvidence && m.synonyms.length ? `    contrast definitions:\n${m.synonyms.map(term => {
      const evidence = m.contrastDefinitions!.find(c => c.synonym === term)!;
      return `      ${term}: ${[...new Set(evidence.definitions.map(d => d.definition))].join("; ")}`;
    }).join("\n")}\n` : "") +
    `    source examples: ${m.examples.map(e => `${e.source_ref}: ${e.text}`).join("; ") || "none"}\n` +
    `    usage-note senses: ${m.usageNotes.map(n => `${n.source_ref}: ${n.definition}`).join("; ") || "none"}\n` +
    `    origin: ${m.origin?.text ?? "none"}`).join("\n\n");
}
export function checkWrittenLesson(input: WriterInput, value: unknown): WrittenLesson {
  const parsed = writerResultSchema.safeParse(value);
  if (!parsed.success) throw new PrivateError("writer_schema_invalid");
  const lesson = parsed.data, ids = lesson.meanings.map(m => m.meaning_id);
  if (ids.length !== input.meanings.length || new Set(ids).size !== ids.length || ids.some(id => !input.meanings.some(m => m.ref === id)))
    throw new PrivateError("writer_meaning_coverage_invalid");
  const nonempty = (value: string) => Boolean(value.trim());
  const escapedHeadword = input.headword.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const containsHeadword = new RegExp(`(^|[^\\p{L}\\p{N}])${escapedHeadword}($|[^\\p{L}\\p{N}])`, "iu");
  for (const m of lesson.meanings) {
    const planned = input.meanings.find(p => p.ref === m.meaning_id)!;
    const generatedText = [...m.examples, m.situation, m.not_for, ...m.common_patterns, ...m.synonyms.flatMap(s => [s.more, s.less]), ...m.usage_notes.map(n => n.text), m.origin_note]
      .filter((value): value is string => value !== null).map(value => ` ${normalizeSourceText(value)} `);
    if (input.excludedQuotations.some(q => { const normalized = normalizeSourceText(q.text); return normalized && generatedText.some(value => value.includes(` ${normalized} `)); }))
      throw new PrivateError("writer_external_quotation");
    if (m.examples.length !== 3 || !m.examples.every(nonempty) || !nonempty(m.situation) || !nonempty(m.not_for)) throw new PrivateError("writer_teaching_fields_invalid");
    const terms = m.synonyms.map(s => s.synonym);
    if (terms.length !== planned.synonyms.length || new Set(terms).size !== terms.length || terms.some(t => !planned.synonyms.includes(t)) ||
      m.synonyms.some(s => [s.more, s.less].some(side => side !== null && (!nonempty(side) || side.trim().split(/\s+/u).length > 3))))
      throw new PrivateError("writer_contrast_invalid");
    const refs = m.usage_notes.map(n => n.source_ref);
    if (refs.length !== planned.usageNotes.length || new Set(refs).size !== refs.length || refs.some(ref => !planned.usageNotes.some(n => n.source_ref === ref)) || !m.usage_notes.every(n => nonempty(n.text)))
      throw new PrivateError("writer_usage_notes_invalid");
    if (!m.common_patterns.length || m.common_patterns.some(p => !nonempty(p) || /[\r\n]/u.test(p) || !containsHeadword.test(p)))
      throw new PrivateError("writer_patterns_invalid");
    if (m.origin_note !== null && (!planned.origin || !nonempty(m.origin_note))) throw new PrivateError("writer_origin_invalid");
  }
  return lesson;
}
export function createWriterStage(configuration: WriterConfiguration, boundInput: WriterInput): StageDefinition<WriterInput, WrittenLesson> {
  const config = writerConfigurationSchema.parse(configuration), input = writerInputSchema.parse(boundInput);
  if (config.contrastEvidence && input.meanings.some(m => m.contrastDefinitions === undefined)) throw new PrivateError("writer_contrast_evidence_missing");
  return { name: "writer", configuration: config, fingerprint: fingerprint({ config, outputSchema: z.toJSONSchema(writerResultSchema) }), inputSchema: writerInputSchema, resultSchema: writerResultSchema,
    render(value) {
      if (fingerprint(writerInputSchema.parse(value)) !== fingerprint(input)) throw new PrivateError("stage_input_invalid");
      return { model: config.pinnedModel, max_tokens: config.maxOutputTokens,
        messages: [{ role: "system", content: [{ type: "text", text: config.prompt }] }, { role: "user", content: writerPayload(input, config.contrastEvidence) }],
        // The shared verified adapter uses this fixed wire name for structured output.
        response_format: { type: "json_schema", json_schema: { name: "plan", strict: true, schema: z.toJSONSchema(writerResultSchema) } },
        provider: { only: [config.provider], order: [config.provider], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0.4, completion: 1.8, request: 0 } }, usage: { include: true } };
    },
    validate(raw) {
      try {
        const schema = lunaExchangeSchema.parse(JSON.parse(raw)).schema;
        if (config.schema === "wordwell-writer-configuration-v1" && schema !== "wordwell-luna-exchange-v3") throw new PrivateError("luna_lookup_history_missing");
        if (config.schema === "wordwell-writer-configuration-v2" && schema !== "wordwell-luna-exchange-v4") throw new PrivateError("luna_inline_evidence_missing");
        checkLunaRouting(raw, config);
        const envelope = z.object({ model: z.enum([config.requestedModel, config.pinnedModel]), provider: z.literal("OpenAI"), choices: z.array(z.object({
          finish_reason: z.literal("stop"), message: z.object({ content: z.string(), refusal: z.null().optional() }).passthrough() }).passthrough()).length(1) }).passthrough().parse(JSON.parse(completionBody(raw)));
        return { ok: true, result: checkWrittenLesson(input, JSON.parse(envelope.choices[0].message.content)) };
      } catch (error) { return { ok: false, code: error instanceof PrivateError ? error.code : "writer_response_invalid" }; }
    }
  };
}
