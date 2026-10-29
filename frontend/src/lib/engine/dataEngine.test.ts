import { describe, expect, it } from "vitest";
import {
  getDataset,
  getDatasetProfile,
  loadFromCSVText,
  runQuery,
  setDataset,
  suggestQuestions,
} from "./dataEngine";
import type { DataRow, ParsedQuery } from "./types";

const query = (overrides: Partial<ParsedQuery> = {}): ParsedQuery => ({
  metric: "revenue",
  aggregation: "sum",
  dimensions: ["category"],
  filters: [],
  chart_type: "bar",
  sort_by: "metric",
  sort_order: "desc",
  limit: 10,
  title: "Revenue by category",
  x_label: "Category",
  y_label: "Revenue",
  ...overrides,
});

const rows: DataRow[] = [
  { category: "B", revenue: 20, order_date: "2024-02-01", region: "South" },
  { category: "A", revenue: 10, order_date: "2024-01-01", region: "North" },
  { category: "B", revenue: 5, order_date: "2024-01-15", region: "North" },
];

describe("CSV loading and profiling", () => {
  it("looks up custom datasets exactly without substituting another workspace", () => {
    const workspaceId = `dataset-test-${Date.now()}`;
    const customRows = [{ product: "Laptop", revenue: 2700 }];
    setDataset(workspaceId, customRows);

    expect(getDataset(workspaceId)).toEqual(customRows);
    expect(getDataset(`${workspaceId}-stale`)).toBeNull();
    expect(getDataset("default")).toBeNull();
  });

  it("parses quoted commas, numbers, and null markers", () => {
    const parsed = loadFromCSVText(
      'category,revenue,note\n"Home, Kitchen",12.5,"good, value"\nBooks,NA,""\n',
    );

    expect(parsed).toEqual([
      { category: "Home, Kitchen", revenue: 12.5, note: "good, value" },
      { category: "Books", revenue: null, note: null },
    ]);
  });

  it("enriches recognizable dates and profiles column roles", () => {
    const parsed = loadFromCSVText(
      "category,revenue,order_date\nBooks,10,2024-01-15\nGames,20,2024-02-15\n",
    );
    const profile = getDatasetProfile(parsed);

    expect(parsed[0]).toMatchObject({ year: 2024, month: 1, month_name: "Jan", quarter: 1 });
    expect(profile.numeric_columns).toContain("revenue");
    expect(profile.categorical_columns).toContain("category");
    expect(profile.date_columns).toEqual(["year", "month", "month_name", "quarter"]);
    expect(profile.categorical_columns).toContain("order_date");
  });

  it("returns no rows for an empty CSV", () => {
    expect(loadFromCSVText("category,revenue\n")).toEqual([]);
    expect(getDatasetProfile([]).rows).toBe(0);
  });
});

describe("structured query engine", () => {
  it("aggregates and sorts groups by metric descending", () => {
    const result = runQuery(query(), rows);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([
      { category: "B", revenue: 25 },
      { category: "A", revenue: 10 },
    ]);
    expect(result.summary).toMatchObject({
      total: 35,
      average: 17.5,
      max_label: "B",
      max_value: 25,
      row_count: 2,
    });
  });

  it("filters before aggregation and supports record counts", () => {
    const filtered = runQuery(query({ filters: [{ field: "region", op: "eq", value: "North" }] }), rows);
    const counted = runQuery(query({
      metric: "__row_count",
      aggregation: "count",
      dimensions: ["category"],
      sort_by: "metric",
    }), rows);

    expect(filtered.data).toEqual([{ category: "A", revenue: 10 }, { category: "B", revenue: 5 }]);
    expect(counted.data).toEqual([{ category: "B", __row_count: 2 }, { category: "A", __row_count: 1 }]);
  });

  it("sorts month names chronologically", () => {
    const monthly = loadFromCSVText(
      "month_name,revenue\nMar,3\nJan,1\nFeb,2\n",
    );
    const result = runQuery(query({
      dimensions: ["month_name"],
      sort_by: "month_name",
      sort_order: "asc",
    }), monthly);

    expect(result.data.map(row => row.month_name)).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("reports invalid operators and unmatched filters", () => {
    const invalidOperator = runQuery(query({
      filters: [{ field: "region", op: "invalid" as ParsedQuery["filters"][number]["op"], value: "North" }],
    }), rows);
    const unmatched = runQuery(query({
      filters: [{ field: "region", op: "eq", value: "West" }],
    }), rows);

    expect(invalidOperator).toMatchObject({ error: true, message: "Unsupported operator: invalid" });
    expect(unmatched).toMatchObject({ error: true, message: "No data matched your filters. Try broadening your search criteria." });
  });

  it("suggests questions from detected metrics and dimensions", () => {
    expect(suggestQuestions(rows, 3)).toEqual([
      "Show revenue by category",
      "Top 5 category by revenue",
      "Count records by category",
    ]);
  });
});
