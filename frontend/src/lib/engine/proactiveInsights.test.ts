import { describe, expect, it } from "vitest";
import { generateProactiveInsights } from "./proactiveInsights";

describe("deterministic proactive insights", () => {
  it("produces traceable rankings and differences from row data", () => {
    const findings = generateProactiveInsights([
      { category: "A", revenue: 100 },
      { category: "A", revenue: 50 },
      { category: "B", revenue: 80 },
    ], ["revenue"], ["category"]);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({ id: "PI-revenue-1", metric: "revenue" });
    expect(findings[0].evidence[0]).toMatchObject({ id: "PI-revenue-1", value: 150, category: "A" });
    expect(findings[1].evidence[0].value).toBe(70);
    expect(findings.every((finding) => finding.evidence_ids.every((id) => finding.evidence.some((item) => item.id === id)))).toBe(true);
  });

  it("returns no unsupported findings without numeric data", () => {
    expect(generateProactiveInsights([{ category: "A" }], ["revenue"], ["category"])).toEqual([]);
  });
});
