import { describe, expect, it } from "vitest";
import { generateAnalyticalEvidence } from "./analyticalEvidence";
import type { QueryResult } from "./types";

function result(data: Record<string, unknown>[], metric = "revenue", dimensions = ["category"]): QueryResult {
  return {
    data, metric, dimensions, chart_type: "bar", title: "Test",
    x_label: "Category", y_label: "Revenue",
    summary: { total: 0, average: 0, max_value: 0, max_label: null, row_count: data.length },
  };
}

describe("deterministic analytical evidence", () => {
  it("computes totals, averages, ranks, highest, lowest and category differences", () => {
    const packet = generateAnalyticalEvidence(result([
      { category: "A", revenue: 100 }, { category: "B", revenue: 300 }, { category: "C", revenue: 200 },
    ]));
    const values = (type: string) => packet.facts.filter((fact) => fact.calculationType === type).map((fact) => fact.value);
    expect(values("total")).toEqual([600]);
    expect(values("average")).toEqual([200]);
    expect(values("highest")).toEqual([300]);
    expect(values("lowest")).toEqual([100]);
    expect(values("rank")).toEqual([300, 200, 100]);
    expect(values("difference")).toEqual([100]);
  });

  it("computes period change and trend without inventing missing months", () => {
    const packet = generateAnalyticalEvidence(result([
      { month_name: "Jan", revenue: 100 }, { month_name: "Feb", revenue: 150 }, { month_name: "Apr", revenue: 120 },
    ], "revenue", ["month_name"]));
    expect(packet.facts.some((fact) => fact.calculationType === "change" && fact.value === 50)).toBe(true);
    expect(packet.facts.some((fact) => fact.calculationType === "missing_period")).toBe(true);
    expect(packet.facts.some((fact) => fact.calculationType === "trend")).toBe(true);
  });

  it("handles zero totals and negative values without percentage evidence", () => {
    const zero = generateAnalyticalEvidence(result([{ category: "A", revenue: 0 }, { category: "B", revenue: 0 }]));
    expect(zero.unavailableInterpretations.join(" ")).toContain("not positive");
    expect(generateAnalyticalEvidence(result([{ category: "A", revenue: -100 }, { category: "B", revenue: 50 }]))
      .facts.some((fact) => fact.calculationType === "total" && fact.value === -50)).toBe(true);
  });

  it("detects a statistical outlier while leaving sparse data unsupported", () => {
    const outlier = generateAnalyticalEvidence(result([
      { category: "A", revenue: 10 }, { category: "B", revenue: 11 }, { category: "C", revenue: 12 },
      { category: "D", revenue: 13 }, { category: "E", revenue: 14 }, { category: "F", revenue: 15 },
      { category: "G", revenue: 16 }, { category: "H", revenue: 1000 },
    ]));
    expect(outlier.facts.some((fact) => fact.calculationType === "outlier")).toBe(true);
    expect(generateAnalyticalEvidence(result([{ category: "A", revenue: 10 }])).facts.some((fact) => fact.calculationType === "outlier")).toBe(false);
  });
});
