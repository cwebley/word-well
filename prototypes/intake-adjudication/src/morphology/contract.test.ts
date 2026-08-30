import { describe, expect, it } from "vitest";

import { findingJsonSchema, findingSchema } from "./contract.ts";

type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  additionalProperties?: boolean;
};

function objectNodes(node: JsonSchemaNode, path = "$"): [string, JsonSchemaNode][] {
  const found: [string, JsonSchemaNode][] = [];
  if (node.properties) {
    found.push([path, node]);
    for (const [key, child] of Object.entries(node.properties)) {
      found.push(...objectNodes(child, `${path}.${key}`));
    }
  }
  if (node.items) found.push(...objectNodes(node.items, `${path}[]`));
  return found;
}

describe("the JSON schema sent to the provider", () => {
  const nodes = objectNodes(findingJsonSchema as JsonSchemaNode);

  it("describes every object the contract contains", () => {
    expect(nodes.map(([path]) => path)).toEqual(["$", "$.meanings[]"]);
  });

  // Strict structured output is what makes a malformed response a provider-side
  // refusal rather than something we discover halfway through scoring, so both
  // conditions it needs are asserted rather than assumed.
  it("forbids fields the contract does not name", () => {
    for (const [path, node] of nodes) {
      expect(node.additionalProperties, path).toBe(false);
    }
  });

  it("requires every field it names", () => {
    for (const [path, node] of nodes) {
      expect(node.required?.slice().sort(), path).toEqual(Object.keys(node.properties ?? {}).sort());
    }
  });

  it("has no place for a disposition, so the model cannot return one", () => {
    expect(JSON.stringify(findingJsonSchema)).not.toMatch(
      /disposition|advance|quarantine|exclude/i,
    );
  });
});

describe("the validator", () => {
  it("accepts a null diagnostic confidence", () => {
    const finding = {
      claim_id: "x|affix_strip",
      analysis_support: "supported",
      analysis_rationale: "r",
      analysis_evidence_ids: [],
      meanings: [{ sense_ids: ["a"], predictability: "predictable", evidence_ids: [], rationale: "r" }],
      diagnostic_confidence: null,
    };
    expect(findingSchema.safeParse(finding).success).toBe(true);
  });

  it("rejects a finding carrying an extra field", () => {
    const finding = {
      claim_id: "x|affix_strip",
      analysis_support: "supported",
      analysis_rationale: "r",
      analysis_evidence_ids: [],
      meanings: [],
      diagnostic_confidence: null,
      disposition: "exclude",
    };
    expect(findingSchema.safeParse(finding).success).toBe(false);
  });
});
