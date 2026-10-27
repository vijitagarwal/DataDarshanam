import { describe, expect, it } from "vitest";
import { buildChart } from "./chartBuilder";
import type { QueryResult } from "./types";

const result: QueryResult = {
  data: [
    { category: "A", revenue: 10 },
    { category: "B", revenue: 20 },
  ],
  metric: "revenue",
  dimensions: ["category"],
  chart_type: "bar",
  title: "Revenue by category",
  x_label: "Category",
  y_label: "Revenue",
  summary: { total: 30, average: 15, max_value: 20, max_label: "B", row_count: 2 },
};

describe("chart specification generation", () => {
  it("builds a dark bar chart with the result labels and values", () => {
    const spec = buildChart(result, true) as {
      data: Array<Record<string, unknown>>;
      layout: Record<string, unknown>;
    };

    expect(spec.data[0]).toMatchObject({
      type: "bar",
      x: ["A", "B"],
      y: [10, 20],
    });
    expect(spec.layout).toMatchObject({
      title: { text: "Revenue by category" },
      paper_bgcolor: "#0F172A",
    });
  });

  it("uses a light theme when requested", () => {
    const spec = buildChart(result, false) as { layout: Record<string, unknown> };

    expect(spec.layout).toMatchObject({ paper_bgcolor: "#F8FAFC" });
  });
});
