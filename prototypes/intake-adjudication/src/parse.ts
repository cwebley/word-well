// Reading a model's reply against a gate's contract.
//
// Shared because the three ways a structured reply goes wrong are the same for
// every gate: it is not JSON, it does not satisfy the schema, or it satisfies
// the schema while answering about something else. That third one is the
// dangerous one — a well-formed finding attached to the wrong subject scores as
// a valid judgment unless something checks identity — so it is checked here
// rather than left to each gate to remember.

import type { z } from "zod";

import type { ParseResult } from "./gate.ts";

export function parseFinding<T extends object>(
  content: string,
  schema: z.ZodType<T>,
  expectedId: string,
  idOf: (finding: T) => string,
  contractVersion: string,
): ParseResult<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { raw: content, finding: null, error: `output was not JSON (${contractVersion})` };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { raw, finding: null, error: parsed.error.issues.map(issueLine).join("; ") };
  }
  const returned = idOf(parsed.data);
  if (returned !== expectedId) {
    return {
      raw,
      finding: null,
      error: `subject identity lost: expected ${expectedId}, got ${returned}`,
    };
  }
  return { raw, finding: parsed.data, error: null };
}

function issueLine(issue: { path: PropertyKey[]; message: string }): string {
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
