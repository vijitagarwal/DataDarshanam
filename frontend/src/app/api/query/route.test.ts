import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  resolveRequestDataset: vi.fn(),
  parseQuery: vi.fn(),
  runQuery: vi.fn(),
  buildChart: vi.fn(),
  generateInsight: vi.fn(),
}));

vi.mock("@/lib/engine/dataEngine", () => ({
  runQuery: mocks.runQuery,
  getDatasetProfile: () => ({
    rows: rows.length,
    column_count: 2,
    columns: [{ name: "category", role: "categorical" }, { name: "revenue", role: "numeric" }],
    numeric_columns: ["revenue"],
    categorical_columns: ["category"],
    date_columns: [],
    text_columns: [],
  }),
}));
vi.mock("@/lib/engine/datasetSelection", () => ({
  DatasetSelectionError: class DatasetSelectionError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
    ) { super(message); }
  },
  resolveRequestDataset: mocks.resolveRequestDataset,
}));
vi.mock("@/lib/engine/llmParser", () => ({ parseQuery: mocks.parseQuery }));
vi.mock("@/lib/engine/chartBuilder", () => ({ buildChart: mocks.buildChart }));
vi.mock("@/lib/engine/insightGen", () => ({ generateInsight: mocks.generateInsight }));

import { POST } from "./route";

const rows = [{ category: "Books", revenue: 100 }];
const parsed = {
  metric: "revenue",
  aggregation: "sum" as const,
  dimensions: ["category"],
  filters: [],
  chart_type: "bar" as const,
  sort_by: "metric",
  sort_order: "desc" as const,
  limit: 10,
  title: "Revenue by category",
  x_label: "Category",
  y_label: "Revenue",
};
const result = {
  data: [{ category: "Books", revenue: 100 }],
  metric: "revenue",
  dimensions: ["category"],
  chart_type: "bar",
  title: "Revenue by category",
  x_label: "Category",
  y_label: "Revenue",
  summary: { total: 100, average: 100, max_value: 100, max_label: "Books", row_count: 1 },
};

function request(body: string, workspaceId?: string, datasetMode?: "demo" | "custom") {
  return new NextRequest("http://localhost/api/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(workspaceId ? { "X-Workspace-ID": workspaceId } : {}),
      ...(datasetMode ? { "X-Dataset-Mode": datasetMode } : {}),
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveRequestDataset.mockResolvedValue({ rows, mode: "demo" });
  mocks.parseQuery.mockResolvedValue(parsed);
  mocks.runQuery.mockReturnValue(result);
  mocks.buildChart.mockImplementation((_result, isDark) => ({ theme: isDark ? "dark" : "light" }));
  mocks.generateInsight.mockResolvedValue({ insight: "Useful insight.", fallback: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/query", () => {
  it("executes count without requiring a numeric metric", async () => {
    const response = await POST(request(JSON.stringify({
      structured_query: { metric: "", aggregation: "count", dimensions: ["category"] },
    })));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.runQuery.mock.calls[0][0]).toMatchObject({
      metric: "__row_count",
      aggregation: "count",
      dimensions: ["category"],
    });
  });

  it("rejects incompatible structured numeric aggregations", async () => {
    const response = await POST(request(JSON.stringify({
      structured_query: { metric: "category", aggregation: "sum", dimensions: [] },
    })));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("INCOMPATIBLE_AGGREGATION");
    expect(mocks.runQuery).not.toHaveBeenCalled();
  });

  it("rejects unsupported structured dimensions instead of silently dropping them", async () => {
    const response = await POST(request(JSON.stringify({
      structured_query: { metric: "revenue", aggregation: "sum", dimensions: ["unknown"] },
    })));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_STRUCTURED_QUERY");
    expect(mocks.runQuery).not.toHaveBeenCalled();
  });

  it("uses row count semantics when count is selected with a nonnumeric metric", async () => {
    const response = await POST(request(JSON.stringify({
      structured_query: { metric: "category", aggregation: "count", dimensions: ["category"] },
    })));
    expect(response.status).toBe(200);
    expect(mocks.runQuery.mock.calls[0][0]).toMatchObject({
      metric: "__row_count",
      aggregation: "count",
      dimensions: ["category"],
    });
  });

  it("accepts a current finding reference and rejects stale evidence", async () => {
    const valid = await POST(request(JSON.stringify({
      structured_query: {
        metric: "revenue", aggregation: "sum", dimensions: ["category"],
        filters: [{ field: "category", op: "eq", value: "Books" }],
        finding: {
          id: "PI-revenue-1",
          evidence_ids: ["PI-revenue-1"],
          finding_type: "top_category",
          category: "Books",
          aggregation: "sum",
        },
      },
    })));
    expect(valid.status).toBe(200);

    const stale = await POST(request(JSON.stringify({
      structured_query: {
        metric: "revenue", aggregation: "sum", dimensions: ["category"],
        finding: { id: "PI-revenue-old", evidence_ids: ["missing"], finding_type: "top_category" },
      },
    })));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("INVALID_FINDING");
  });
  it("returns the established success response and runs all downstream stages", async () => {
    const response = await POST(request(JSON.stringify({ query: "show revenue by category" }), "workspace-123"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      error: false,
      query: "show revenue by category",
      parsed,
      result,
      insight: "Useful insight.",
      fallback: true,
      used_context: false,
      plotly_spec: { dark: { theme: "dark" }, light: { theme: "light" } },
    });
    expect(mocks.resolveRequestDataset).toHaveBeenCalledOnce();
    expect(mocks.parseQuery).toHaveBeenCalledWith("show revenue by category", rows, null);
    expect(mocks.runQuery).toHaveBeenCalledWith(parsed, rows);
    expect(mocks.buildChart).toHaveBeenCalledTimes(2);
    expect(mocks.generateInsight).toHaveBeenCalledWith("show revenue by category", result);
  });

  it("returns 400 for malformed JSON and invalid request bodies", async () => {
    const malformed = await POST(request('{"query":', "workspace-123"));
    const arrayBody = await POST(request("[]", "workspace-123"));
    const invalidQuery = await POST(request(JSON.stringify({ query: 42 }), "workspace-123"));

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: true, message: "Request body must be valid JSON" });
    expect(arrayBody.status).toBe(400);
    expect(await arrayBody.json()).toEqual({ error: true, message: "Request body must be a JSON object" });
    expect(invalidQuery.status).toBe(400);
    expect(await invalidQuery.json()).toEqual({ error: true, message: "Query must be a string" });
    expect(mocks.parseQuery).not.toHaveBeenCalled();
  });

  it("returns 400 for an empty query", async () => {
    const response = await POST(request(JSON.stringify({ query: "  " })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: true, message: "Query string cannot be empty" });
    expect(mocks.resolveRequestDataset).not.toHaveBeenCalled();
  });

  it("returns parser validation failures without invoking downstream stages", async () => {
    mocks.parseQuery.mockResolvedValue({
      error: true,
      code: "INVALID_QUERY",
      field: "metric",
      message: 'Metric "profit" is not a numeric column in this dataset.',
    });

    const response = await POST(request(JSON.stringify({ query: "show profit" }), "workspace-123"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: false,
      error: true,
      parsed: { error: true, code: "INVALID_QUERY", field: "metric" },
      message: 'Metric "profit" is not a numeric column in this dataset.',
      insight: 'Metric "profit" is not a numeric column in this dataset.',
    });
    expect(mocks.runQuery).not.toHaveBeenCalled();
    expect(mocks.buildChart).not.toHaveBeenCalled();
    expect(mocks.generateInsight).not.toHaveBeenCalled();
  });

  it("returns data-engine errors without chart or insight generation", async () => {
    mocks.runQuery.mockReturnValue({
      ...result,
      error: true,
      message: "No data matched your filters.",
    });

    const response = await POST(request(JSON.stringify({ query: "show revenue" })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: false, error: true, message: "No data matched your filters." });
    expect(mocks.buildChart).not.toHaveBeenCalled();
    expect(mocks.generateInsight).not.toHaveBeenCalled();
  });

  it("does not expose provider failures or stack traces", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.parseQuery.mockRejectedValue(new Error("provider secret token and stack details"));

    const response = await POST(request(JSON.stringify({ query: "show revenue" })));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Query execution failed" });
    expect(JSON.stringify(body)).not.toContain("provider secret token");
    expect(JSON.stringify(body)).not.toContain("stack details");
    expect(mocks.runQuery).not.toHaveBeenCalled();
  });
});
