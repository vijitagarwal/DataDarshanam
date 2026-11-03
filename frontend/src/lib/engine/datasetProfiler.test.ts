import { describe, expect, it } from "vitest";
import { getDatasetProfile, loadFromCSVText } from "./dataEngine";
import { enrichDatasetProfile } from "./datasetProfiler";

describe("deterministic dataset profiling", () => {
  it("computes numeric distribution and duplicate quality facts", () => {
    const rows = [
      { category: "A", revenue: 10 },
      { category: "A", revenue: 20 },
      { category: "A", revenue: 30 },
      { category: "A", revenue: 30 },
    ];
    const profile = enrichDatasetProfile(getDatasetProfile(rows), rows);
    const revenue = profile.columns.find((column) => column.name === "revenue");
    expect(revenue?.numeric_stats).toMatchObject({ min: 10, max: 30, mean: 22.5, median: 25, zero_count: 0 });
    expect(profile.duplicate_row_count).toBe(1);
    expect(profile.health_score).toBeGreaterThanOrEqual(0);
    expect(profile.health_score).toBeLessThanOrEqual(100);
  }, 15_000);

  it("reports missing values and date coverage without changing data", () => {
    const rows = loadFromCSVText([
      { product: "A", order_date: "2025-01-01" },
      { product: undefined, order_date: "2025-02-01" },
      { product: "", order_date: "2025-03-01" },
    ].map((row) => `${row.product ?? ""},${row.order_date}`).join("\n").replace(/^/, "product,order_date\n"));
    const original = JSON.stringify(rows);
    const profile = enrichDatasetProfile(getDatasetProfile(rows), rows);
    expect(profile.quality_warnings?.some((warning) => warning.code === "missing_values" && warning.column === "product")).toBe(true);
    expect(JSON.stringify(rows)).toBe(original);
  });

  it("profiles large inputs without spreading columns into maximum argument calls", () => {
    const rows = Array.from({ length: 20_000 }, (_, index) => ({ category: index % 100, revenue: index }));
    const profile = enrichDatasetProfile(getDatasetProfile(rows), rows);
    const revenue = profile.columns.find((column) => column.name === "revenue");
    expect(profile.duplicate_row_count).toBe(0);
    expect(revenue?.numeric_stats?.min).toBe(0);
    expect(revenue?.numeric_stats?.max).toBe(19_999);
  }, 15_000);
});
