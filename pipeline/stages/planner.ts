import { z } from "zod";
import { fingerprint } from "../config.js";
import { PrivateError } from "../storage/crypto.js";
import type { StageDefinition } from "../execution/stage.js";
import { checkLunaRouting, completionBody, LUNA_LOOKUP_POLICY, lunaExchangeSchema } from "../execution/luna-response.js";

// The approved newer prototype prompt, followed only by explicit source accounting.
export const PLANNER_PROMPT = `You are planning a vocabulary lesson for an adult learner.

Below is a headword and its dictionary senses from Open English WordNet.

Decide which senses become lesson meanings. Senses that teach the same thing become one meaning. Leave out senses an adult learner has no use for.

Write each meaning's definition in plain English. List the sense ids it came from.

A sense that extends another meaning's core idea in the same part of speech — a figurative or specialised use of the same thing — belongs in that meaning's usage_note_sense_ids rather than becoming a meaning of its own. This holds even when the extension reads as a distinct choice. A sense in a different part of speech is never a usage note, and neither is a sense that contradicts the meaning rather than extending it.

Put the meaning a learner is most likely to meet in reading first.

Finally, choose up to four word-family forms a learner should see beside the headword — ones that give another useful part of speech. A form both sources list is a stronger candidate than one only Wiktionary lists. Choose none rather than a rare or negated form.

Each sense lists words to contrast the headword against: synonyms, and broader or similar terms where it has no synonym. For each meaning, choose up to four from the senses you grouped into it — ones that each show something different about the headword. Skip one that differs from another you chose only in spelling or formality.

Account for every supplied sense exactly once: in sense_ids, in usage_note_sense_ids, or in omitted_source_meanings with its source_ref and a reason.`;

const pos = z.enum(["noun", "verb", "adjective", "adverb"]);
const ref = z.string().regex(/^s[1-9][0-9]*$/);
const support = z.object({ source: z.enum(["oewn", "kaikki"]), from: z.string(), to: z.string(), type: z.string() }).strict();
export const plannerInputSchema = z.object({ headword: z.string().min(1).max(200), bundleId: z.string().regex(/^[a-f0-9]{64}$/),
  meanings: z.array(z.object({ ref, sourceId: z.string(), entryId: z.string(), conceptId: z.string(), order: z.number().int().positive(),
    recordedPos: z.string(), partOfSpeech: pos, definition: z.string().min(1), examples: z.array(z.string()),
    contrasts: z.array(z.object({ word: z.string().min(1), type: z.enum(["direct_member", "hypernym", "similar"]), support }).strict()) }).strict()).min(1),
  family: z.array(z.object({ word: z.string().min(1), supports: z.array(support).min(1) }).strict())
}).strict().superRefine((input, ctx) => {
  const ids = input.meanings.map(m => m.sourceId);
  if (new Set(ids).size !== ids.length || input.meanings.some((m, i) => m.ref !== `s${i + 1}`) || new Set(input.family.map(f => f.word)).size !== input.family.length)
    ctx.addIssue({ code: "custom", message: "planner_input_identity_invalid" });
});
export type PlannerInput = z.infer<typeof plannerInputSchema>;
export const planSchema = z.object({ meanings: z.array(z.object({ definition: z.string(), part_of_speech: pos,
  sense_ids: z.array(z.string()), usage_note_sense_ids: z.array(z.string()), synonyms: z.array(z.string()) }).strict()),
  word_family: z.array(z.string()), omitted_source_meanings: z.array(z.object({ source_ref: z.string(), reason: z.string() }).strict())
}).strict();
export type LessonPlan = z.infer<typeof planSchema>;
const legacyPlannerConfigurationSchema = z.object({ schema: z.literal("wordwell-planner-configuration-v1"), stage: z.literal("planner"),
  route: z.literal("openrouter-aisdk-v1"), requestedModel: z.literal("openai/gpt-5.6-luna"), pinnedModel: z.literal("openai/gpt-5.6-luna-20260709"),
  provider: z.literal("openai"), maxOutputTokens: z.number().int().min(64).max(16000), prompt: z.string().min(1)
}).strict();
const routingLookupSchema = z.object({ maxAttempts: z.literal(6), maxWaitMs: z.literal(30000), delaysMs: z.tuple([z.literal(1000), z.literal(2000), z.literal(4000), z.literal(8000), z.literal(8000)]) }).strict();
// Historical v1 experiments remain inspectable under their original validation.
export const plannerConfigurationSchema = z.union([legacyPlannerConfigurationSchema,
  legacyPlannerConfigurationSchema.extend({ schema: z.literal("wordwell-planner-configuration-v2"), routingVerification: z.literal("authenticated-generation-v1") }).strict(),
  legacyPlannerConfigurationSchema.extend({ schema: z.literal("wordwell-planner-configuration-v3"), routingVerification: z.literal("authenticated-generation-poll-v1"),
    routingLookup: routingLookupSchema }).strict(),
  legacyPlannerConfigurationSchema.extend({ schema: z.literal("wordwell-planner-configuration-v4"), routingVerification: z.literal("authenticated-generation-resumable-v1"),
    routingLookup: routingLookupSchema, metadataRecovery: z.literal("saved-completion-append-only-rounds-v1") }).strict()]);
export type PlannerConfiguration = z.infer<typeof plannerConfigurationSchema>;
export const PLANNER_CONFIGURATION: PlannerConfiguration = { schema: "wordwell-planner-configuration-v4", stage: "planner", route: "openrouter-aisdk-v1",
  requestedModel: "openai/gpt-5.6-luna", pinnedModel: "openai/gpt-5.6-luna-20260709", provider: "openai", maxOutputTokens: 16000, prompt: PLANNER_PROMPT,
  routingVerification: "authenticated-generation-resumable-v1", routingLookup: { ...LUNA_LOOKUP_POLICY, delaysMs: [...LUNA_LOOKUP_POLICY.delaysMs] }, metadataRecovery: "saved-completion-append-only-rounds-v1" };

export function plannerPayload(input: PlannerInput) {
  const senses = input.meanings.map(m => `${m.ref} [${m.partOfSpeech}] ${m.definition}` +
    (m.examples.length ? `\n    examples: ${m.examples.join("; ")}` : "") +
    (["direct_member", "hypernym", "similar"] as const).map(type => {
      const words = [...new Set(m.contrasts.filter(c => c.type === type).map(c => c.word))];
      return words.length ? `\n    ${{ direct_member: "synonyms", hypernym: "broader terms", similar: "similar terms" }[type]}: ${words.join(", ")}` : "";
    }).join("")).join("\n");
  let family = "";
  if (input.family.length) {
    family = "\n\nword family candidates";
    for (const both of [true, false]) {
      const words = input.family.filter(f => (new Set(f.supports.map(s => s.source)).size > 1) === both).map(f => f.word);
      if (words.length) family += `\n  listed by ${both ? "both sources" : "one source"}: ${words.join(", ")}`;
    }
  }
  return `headword: ${input.headword}\n\n${senses}${family}`;
}
export function checkPlan(input: PlannerInput, value: unknown): LessonPlan {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) throw new PrivateError("planner_schema_invalid");
  const plan = parsed.data, supplied = new Map(input.meanings.map(m => [m.ref, m])), assigned: string[] = [];
  const distinct = (values: string[]) => new Set(values.map(v => v.toLowerCase())).size === values.length;
  for (const m of plan.meanings) {
    if (!m.definition.trim() || !m.sense_ids.length) throw new PrivateError("planner_defining_support_missing");
    for (const id of [...m.sense_ids, ...m.usage_note_sense_ids]) {
      const source = supplied.get(id);
      if (!source) throw new PrivateError("planner_source_unknown");
      if (source.partOfSpeech !== m.part_of_speech) throw new PrivateError("planner_pos_invalid");
      assigned.push(id);
    }
    const allowed = new Set(m.sense_ids.flatMap(id => supplied.get(id)!.contrasts.map(c => c.word)));
    if (m.synonyms.length > 4 || !distinct(m.synonyms) || m.synonyms.some(word => !allowed.has(word))) throw new PrivateError("planner_contrast_invalid");
  }
  for (const omission of plan.omitted_source_meanings) {
    if (!supplied.has(omission.source_ref)) throw new PrivateError("planner_source_unknown");
    if (!omission.reason.trim()) throw new PrivateError("planner_omission_reason_missing");
    assigned.push(omission.source_ref);
  }
  if (assigned.length !== supplied.size || new Set(assigned).size !== assigned.length) throw new PrivateError("planner_source_accounting_invalid");
  if (plan.word_family.length > 4 || !distinct(plan.word_family) || plan.word_family.some(word => !input.family.some(f => f.word === word))) throw new PrivateError("planner_family_invalid");
  return plan;
}
export function createPlannerStage(configuration: PlannerConfiguration, boundInput: PlannerInput): StageDefinition<PlannerInput, LessonPlan> {
  const config = plannerConfigurationSchema.parse(configuration), input = plannerInputSchema.parse(boundInput);
  return { name: "planner", configuration: config, fingerprint: fingerprint({ config, outputSchema: z.toJSONSchema(planSchema) }), inputSchema: plannerInputSchema, resultSchema: planSchema,
    render(value) {
      if (fingerprint(plannerInputSchema.parse(value)) !== fingerprint(input)) throw new PrivateError("stage_input_invalid");
      return { model: config.pinnedModel, max_tokens: config.maxOutputTokens,
        messages: [{ role: "system", content: [{ type: "text", text: config.prompt }] }, { role: "user", content: plannerPayload(input) }],
        response_format: { type: "json_schema", json_schema: { name: "plan", strict: true, schema: z.toJSONSchema(planSchema) } },
        provider: { only: [config.provider], order: [config.provider], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0.4, completion: 1.8, request: 0 } },
        usage: { include: true } };
    },
    validate(raw) {
      try {
        const historical = config.schema === "wordwell-planner-configuration-v1";
        if (config.schema === "wordwell-planner-configuration-v3" && lunaExchangeSchema.parse(JSON.parse(raw)).schema !== "wordwell-luna-exchange-v2") throw new PrivateError("luna_lookup_history_missing");
        if (config.schema === "wordwell-planner-configuration-v4" && lunaExchangeSchema.parse(JSON.parse(raw)).schema !== "wordwell-luna-exchange-v3") throw new PrivateError("luna_lookup_history_missing");
        if (!historical) checkLunaRouting(raw, config);
        const envelope = z.object({ model: historical ? z.literal(config.pinnedModel) : z.enum([config.requestedModel, config.pinnedModel]), provider: z.literal("OpenAI"), choices: z.array(z.object({
          finish_reason: z.literal("stop"), message: z.object({ content: z.string(), refusal: z.null().optional() }).passthrough() }).passthrough()).length(1) }).passthrough().parse(JSON.parse(historical ? raw : completionBody(raw)));
        return { ok: true, result: checkPlan(input, JSON.parse(envelope.choices[0].message.content)) };
      } catch (error) { return { ok: false, code: error instanceof PrivateError ? error.code : "planner_response_invalid" }; }
    }
  };
}
