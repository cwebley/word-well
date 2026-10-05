// What the shared executor needs from a stage. Production and evaluation get
// the same definition, so they render, validate and decide identically.
import type { z } from "zod";

export type Validation<Result> = { ok: true; result: Result } | { ok: false; code: string };

export interface StageDefinition<Input, Result> {
  readonly name: string;
  // Opaque identity of the full configuration material below.
  readonly fingerprint: string;
  // Saved with every experiment so resume never adopts current files.
  readonly configuration: unknown;
  readonly inputSchema: z.ZodType<Input>;
  readonly resultSchema: z.ZodType<Result>;
  // Deterministic request body. Throws PrivateError("stage_input_invalid").
  render(input: Input): unknown;
  // Raw response text in, validated result or a fixed code out. Never throws.
  validate(raw: string): Validation<Result>;
}
