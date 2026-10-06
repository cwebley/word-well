import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PrivateError } from "../storage/crypto.js";

const data = z.record(z.string(), z.unknown());
export const bundleSchema = z.object({
  scope: data,
  artifacts: z.array(z.object({ source: z.string(), sha256: z.string(), bytes: z.number(), path: z.string(), metadata: data }).strict()),
  entries: z.array(z.object({ source: z.enum(["oewn", "kaikki"]), id: z.string(), headword: z.string(), pos: z.string(), order: z.number().int(), role: z.enum(["candidate", "linked"]), raw: z.string(), rawSha256: z.string(), locator: data, data }).strict()),
  meanings: z.array(z.object({ source: z.enum(["oewn", "kaikki"]), entryId: z.string(), id: z.string(), order: z.number().int(), conceptId: z.string().nullable(), relations: z.array(data), data }).strict()),
  concepts: z.array(z.object({ source: z.literal("oewn"), id: z.string(), order: z.number().int(), raw: z.string(), rawSha256: z.string(), data }).strict()),
  relations: z.array(z.object({ source: z.enum(["oewn", "kaikki"]), from: z.string(), to: z.string(), word: z.string(), type: z.string(), purpose: z.enum(["contrast", "family"]), data: data.optional() }).strict()),
  frequency: z.object({ order: z.number().int(), form: z.string(), tokens: z.array(z.string()), storedFrequency: z.number(), directZipf: z.number().nullable() }).strict(),
  supplemental: z.object({ page_id: z.string(), revision_id: z.string(), text_sha256: z.string(), raw_wikitext: z.string(), authenticatesKaikki: z.literal(false), meanings: z.array(z.object({ pos: z.string(), line: z.number(), raw: z.string(), qualifiers: z.array(z.object({ template: z.string(), arguments: z.array(z.string()), labels: z.array(z.string()) }).strict()) }).strict()) }).strict(),
  diagnostics: z.array(data),
  coverage: z.object({ candidates: z.tuple([z.literal("emulate")]), fullCorpus: z.literal(false), oewnMeanings: z.literal(3), kaikkiMeanings: z.literal(5) }).strict(),
  modelCalls: z.literal(0)
}).strict();
export type EvidenceBundle = z.infer<typeof bundleSchema>;

export async function readScopedEvidence(options: { directory?: string; scope: unknown; manifest: unknown }): Promise<EvidenceBundle> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.WORDWELL_SOURCE_PYTHON ?? "python3", [fileURLToPath(new URL("./scoped_bundle.py", import.meta.url)),
      "--input-json", ...(options.directory ? ["--directory", options.directory] : [])], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ scope: options.scope, manifest: options.manifest }));
    const output: Buffer[] = [], errors: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) child.kill();
      else output.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { if (errors.length < 100) errors.push(chunk); });
    child.on("error", () => reject(new PrivateError("source_python_unavailable")));
    child.on("close", code => {
      if (code !== 0) {
        const diagnostic = Buffer.concat(errors).toString().trim();
        reject(new PrivateError(/^scoped_[a-z_]+$/.test(diagnostic) ? diagnostic : "scoped_evidence_unavailable"));
      } else {
        try { resolve(bundleSchema.parse(JSON.parse(Buffer.concat(output).toString()))); }
        catch { reject(new PrivateError("scoped_mapping_invalid")); }
      }
    });
  });
}
