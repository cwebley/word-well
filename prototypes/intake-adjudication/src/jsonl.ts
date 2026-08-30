// Reading a committed JSONL dataset, with the schema doing the checking.
//
// The datasets in this prototype are hand-edited and committed, so a typo in one
// is a real possibility and a silent one: a missing field would otherwise surface
// as `undefined` somewhere far away. Validating at the read means the line number
// is still in scope when it fails.

import { readFileSync } from "node:fs";
import type { z } from "zod";

export function readJsonl<T>(path: string, schema: z.ZodType<T>): T[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      const parsed = schema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`${path} line ${i + 1} is invalid: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}
