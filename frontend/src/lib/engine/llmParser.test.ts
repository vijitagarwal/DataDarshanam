import { describe, expect, it } from "vitest";
import { parseModelOutput, validateParsedQuery } from "./llmParser";
import type { DataRow } from "./types";

const rows: DataRow[] = [
  { category: "Books", revenue: 100, region: "North" },
  { category: "Games", revenue: 50, region: "South" },
];

const validQuery = {
  metric: "revenue",
  aggregation: "sum",
  dimensions: ["category"],
  filters: [{ field: "region", op: "eq", value: "North" }],
  chart_type: "bar",
  sort_by: "metric",
  sort_order: "desc",
  limit: 10,
  title: "Revenue by category",
  x_label: "Category",
  y_label: "Revenue",
};

function expectInvalid(value: unknown, message: string) {
  expect(validateParsedQuery(value, rows)).toMatchObject({
    error: true,
    code: "INVALID_QUERY",
    message,
  });
}

describe("LLM query validation", () => {
  it("accepts a complete query using profiled columns", () => {
    expect(validateParsedQuery(validQuery, rows)).toEqual(validQuery);
  });

  it("accepts JSON extracted from a model response", () => {
    expect(parseModelOutput(`\`\`\`json\n${JSON.stringify(validQuery)}\n\`\`\``, rows)).toEqual(validQuery);
  });

  it("rejects malformed JSON", () => {
    expect(parseModelOutput('{"metric":"revenue",}', rows)).toMatchObject({
      error: true,
      code: "INVALID_QUERY",
      message: "The AI returned malformed JSON.",
    });
  });

  it("rejects missing required fields", () => {
    const missingTitle = Object.fromEntries(
      Object.entries(validQuery).filter(([key]) => key !== "title"),
    );
    expectInvalid(missingTitle, 'Missing required field "title" in AI query output.');
  });

  it("rejects invalid metrics and dimensions", () => {
    expectInvalid({ ...validQuery, metric: "profit" }, 'Metric "profit" is not a numeric column in this dataset.');
    expectInvalid({ ...validQuery, dimensions: ["unknown"] }, 'Dimension "unknown" is not a column in this dataset.');
  });

  it("rejects invalid filter operators and fields", () => {
    expectInvalid({
      ...validQuery,
      filters: [{ field: "region", op: "contains", value: "North" }],
    }, 'Unsupported filter operator "contains".');
    expectInvalid({
      ...validQuery,
      filters: [{ field: "country", op: "eq", value: "India" }],
    }, 'Filter field "country" is not a column in this dataset.');
  });

  it("rejects invalid sort fields and limits", () => {
    expectInvalid({ ...validQuery, sort_by: "unknown" }, 'Sort field "unknown" is not available in this dataset.');
    expectInvalid({ ...validQuery, limit: 0 }, "Limit must be an integer between 1 and 100.");
    expectInvalid({ ...validQuery, limit: 101 }, "Limit must be an integer between 1 and 100.");
  });

  it("rejects unsupported chart types and unexpected fields", () => {
    expectInvalid({ ...validQuery, chart_type: "area" }, 'Unsupported chart type "area".');
    expectInvalid({ ...validQuery, extra: true }, 'Unexpected field "extra" in AI query output.');
  });
});
