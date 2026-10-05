import { z } from "zod";
import { digest, PrivateError } from "../../pipeline/storage/crypto.js";

export const opaqueId = z.uuid();
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0);
export function firmLabel(value: { firm: boolean; finding: "clear" | "blocked" | null }): boolean {
  return value.firm && value.finding !== null;
}
const contentFieldsSchema = z.object({
  headword: text(200),
  finding: z.enum(["clear", "blocked"]).nullable(),
  reason: z.string().max(2000).default(""),
  firm: z.boolean(),
  provenance: z.string().max(4000),
  variantGroup: opaqueId,
  answersInspected: z.boolean()
}).strict();
export const contentSchema = contentFieldsSchema.refine(value => !value.firm || firmLabel(value));
export type CaseContent = z.infer<typeof contentSchema>;

export function parseCaseContent(value: unknown): CaseContent {
  const parsed = contentFieldsSchema.safeParse(value);
  if (!parsed.success) throw new PrivateError("case_invalid");
  if (parsed.data.firm && !firmLabel(parsed.data))
    throw new PrivateError("firm_finding_required");
  return parsed.data;
}

const approvalSchema = z.object({
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  approvedAt: z.iso.datetime(),
  reviewer: z.literal("local-owner")
}).strict();
export const caseSchema = z.object({
  id: opaqueId,
  content: contentSchema,
  approval: approvalSchema.nullable(),
  split: z.enum(["development", "held-out"]).nullable(),
  assignedAt: z.iso.datetime().nullable()
}).strict();
export type AuthoringCase = z.infer<typeof caseSchema>;
export const inspectionHistorySchema = z.array(z.object({ caseId: opaqueId, headword: text(200), variantGroup: opaqueId }).strict()).max(10000);
export const workspaceSchema = z.object({
  schema: z.literal("wordwell-authoring-v1"),
  id: opaqueId,
  revision: z.number().int().nonnegative(),
  cases: z.array(caseSchema).max(1000),
  inspectionHistory: inspectionHistorySchema
}).strict();
export type Workspace = z.infer<typeof workspaceSchema>;

export function contentDigest(content: CaseContent): string {
  // Explicit order gives a stable complete content identity after schema parsing.
  return digest(JSON.stringify(contentSchema.parse(content)));
}

export function approved(row: AuthoringCase): boolean {
  return firmLabel(row.content) &&
    row.approval?.contentDigest === contentDigest(row.content);
}

function normalized(headword: string): string {
  return headword.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
}

// Connect both owner groups and normalized variants, including unassigned rows.
function caseConnections(workspace: Workspace) {
  const ids = new Set<string>();
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const next = parent.get(id)!;
    if (next === id) return id;
    const root = find(next); parent.set(id, root); return root;
  };
  const groups = new Map<string, string>();
  const connect = (id: string, headword: string, variantGroup: string, caseId: string) => {
    const norm = normalized(headword);
    const keys = [`case:${caseId}`, `group:${variantGroup}`, ...(norm ? [`word:${norm}`] : [])];
    for (const key of keys) {
      const other = groups.get(key);
      if (other) parent.set(find(id), find(other));
      else groups.set(key, id);
    }
  };
  for (const row of workspace.cases) {
    if (ids.has(row.id)) throw new PrivateError("duplicate_case");
    ids.add(row.id); parent.set(row.id, row.id);
    connect(row.id, row.content.headword, row.content.variantGroup, row.id);
  }
  // Historical inputs/groups stay inspected even when their case is edited.
  for (const [index, item] of workspace.inspectionHistory.entries()) {
    const id = `history:${index}`; parent.set(id, id);
    connect(id, item.headword, item.variantGroup, item.caseId);
  }
  const inspected = new Set<string>();
  for (const [index] of workspace.inspectionHistory.entries()) inspected.add(find(`history:${index}`));
  for (const row of workspace.cases) if (row.content.answersInspected) inspected.add(find(row.id));
  return { find, inspected };
}

export function inspectionRestricted(workspace: Workspace): Set<string> {
  const { find, inspected } = caseConnections(workspace);
  return new Set(workspace.cases.filter(row => inspected.has(find(row.id))).map(row => row.id));
}

// Preserve inherited exposure before and after edits, not just the explicit flag.
export function rememberInspection(workspace: Workspace): void {
  const restricted = inspectionRestricted(workspace);
  for (const row of workspace.cases) {
    const { headword, variantGroup } = row.content;
    if (restricted.has(row.id) && !workspace.inspectionHistory.some(item => item.caseId === row.id && item.headword === headword && item.variantGroup === variantGroup))
      workspace.inspectionHistory.push({ caseId: row.id, headword, variantGroup });
  }
}

export function validateWorkspace(workspace: Workspace): void {
  const { find, inspected } = caseConnections(workspace);
  const splits = new Map<string, string>();
  for (const row of workspace.cases) {
    if (row.approval && !approved(row)) throw new PrivateError("approval_invalid");
    if (row.split && (!approved(row) || !row.assignedAt)) throw new PrivateError("approval_required");
    if (!row.split && row.assignedAt) throw new PrivateError("split_invalid");
    if (row.split === "held-out" && row.content.answersInspected) throw new PrivateError("heldout_inspected");
    if (!row.split) continue;
    const root = find(row.id);
    if (row.split === "held-out" && inspected.has(root)) throw new PrivateError("heldout_inspected_variant");
    if (splits.has(root) && splits.get(root) !== row.split) throw new PrivateError("variant_split_conflict");
    splits.set(root, row.split);
  }
}

export function coverage(workspace: Workspace) {
  const count = (split: AuthoringCase["split"], finding: "clear" | "blocked") =>
    workspace.cases.filter(row => approved(row) && row.split === split && row.content.finding === finding).length;
  return {
    development: { clear: count("development", "clear"), blocked: count("development", "blocked") },
    heldOut: { clear: count("held-out", "clear"), blocked: count("held-out", "blocked") },
    exploration: workspace.cases.filter(row => !row.content.firm).length,
    awaitingApproval: workspace.cases.filter(row => row.content.firm && !approved(row)).length,
    awaitingSplit: workspace.cases.filter(row => approved(row) && !row.split).length
  };
}
