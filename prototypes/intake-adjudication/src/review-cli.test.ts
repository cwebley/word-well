import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assembleReviewPayload, buildReviewHtml, escapeEmbeddedJson } from "./review-cli.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("calibration review generator", () => {
  it("embeds hostile source text without ending the data script", () => {
    const escaped = escapeEmbeddedJson({ definition: "before </script><script>alert(1)</script>" });

    expect(escaped).not.toContain("</script>");
    expect(JSON.parse(escaped)).toEqual({
      definition: "before </script><script>alert(1)</script>",
    });
  });

  it("assembles only the 12 frozen members and separates endorsement", () => {
    const payload = assembleReviewPayload({
      evidencePath: resolve(root, "evidence/calibration-silver.claims.jsonl"),
      partitionsPath: resolve(root, "cases/calibration-v1.partitions.json"),
    });

    expect(payload.cases).toHaveLength(12);
    expect(payload.partition_version).toBe("morphology-calibration/2");
    expect(payload.cases[0]?.claim).not.toHaveProperty("policy_context");
    expect(payload.cases[0]?.endorsements).toEqual(expect.any(Number));
  });

  it("produces an offline page with escaped data and no dependencies", () => {
    const payload = assembleReviewPayload({
      evidencePath: resolve(root, "evidence/calibration-silver.claims.jsonl"),
      partitionsPath: resolve(root, "cases/calibration-v1.partitions.json"),
    });
    const html = buildReviewHtml(payload);

    expect(html).toContain('<script id="review-data" type="application/json">');
    expect(html).not.toMatch(/<script[^>]+src=/u);
    expect(html).not.toMatch(/<link[^>]+stylesheet/u);
    expect(html).not.toContain("innerHTML");
  });

  it("uses quick radio choices and keeps provisional answers behind a reveal control", () => {
    const payload = assembleReviewPayload({
      evidencePath: resolve(root, "evidence/calibration-silver.claims.jsonl"),
      partitionsPath: resolve(root, "cases/calibration-v1.partitions.json"),
      provisionalPath: resolve(root, "labels/calibration-silver.provisional.jsonl"),
    });
    const html = buildReviewHtml(payload);

    expect(html).toContain('input.type="radio"');
    expect(html).not.toContain("function optionSelect");
    expect(html).toContain("Reveal provisional");
    expect(html.indexOf('"Provisional label"')).toBeLessThan(
      html.indexOf('"Source meanings ("'),
    );
  });
});
