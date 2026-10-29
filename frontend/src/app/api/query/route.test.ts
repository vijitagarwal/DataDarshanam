import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDataset: vi.fn(),
  loadDefaultData: vi.fn(),
  parseQuery: vi.fn(),
  runQuery: vi.fn(),
  buildChart: vi.fn(),
  generateInsight: vi.fn(),
}));

vi.mock("@/lib/engine/dataEngine", () => ({
  getDataset: mocks.getDataset,
  loadDefaultData: mocks.loadDefaultData,
  runQuery: mocks.runQuery,
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
  mocks.getDataset.mockReturnValue(rows);
  mocks.loadDefaultData.mockResolvedValue(rows);
  mocks.parseQuery.mockResolvedValue(parsed);
  mocks.runQuery.mockReturnValue(result);
  mocks.buildChart.mockImplementation((_result, isDark) => ({ theme: isDark ? "dark" : "light" }));
  mocks.generateInsight.mockResolvedValue({ insight: "Useful insight.", fallback: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/query", () => {
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
    expect(mocks.getDataset).toHaveBeenCalledWith("workspace-123");
    expect(mocks.parseQuery).toHaveBeenCalledWith("show revenue by category", rows, null);
    expect(mocks.runQuery).toHaveBeenCalledWith(parsed, rows);
    expect(mocks.buildChart).toHaveBeenCalledTimes(2);
    expect(mocks.generateInsight).toHaveBeenCalledWith("show revenue by category", result);
  });

  it("preserves the legacy demo selection when no workspace is supplied", async () => {
    mocks.getDataset.mockReturnValue(null);
    const response = await POST(request(JSON.stringify({ query: "show revenue" })));

    expect(response.status).toBe(200);
    expect(mocks.getDataset).not.toHaveBeenCalled();
    expect(mocks.loadDefaultData).toHaveBeenCalledOnce();
    expect(mocks.parseQuery).toHaveBeenCalledWith("show revenue", rows, null);
  });

  it("uses the bundled dataset only when demo mode is explicit", async () => {
    const response = await POST(request(JSON.stringify({ query: "show revenue" }), undefined, "demo"));

    expect(response.status).toBe(200);
    expect(mocks.loadDefaultData).toHaveBeenCalledOnce();
    expect(mocks.getDataset).not.toHaveBeenCalled();
    expect(mocks.parseQuery).toHaveBeenCalledWith("show revenue", rows, null);
  });

  it("rejects a custom selection when its workspace ID is absent", async () => {
    const response = await POST(request(JSON.stringify({ query: "show revenue" }), undefined, "custom"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "INVALID_DATASET_SELECTION",
      error: "A valid workspace ID is required for a custom dataset.",
    });
    expect(mocks.loadDefaultData).not.toHaveBeenCalled();
    expect(mocks.parseQuery).not.toHaveBeenCalled();
  });

  it.each(["stale-workspace-123", "unknown-workspace-123"])(
    "does not substitute demo data for missing custom workspace %s",
    async (workspaceId) => {
      mocks.getDataset.mockReturnValue(null);
      const response = await POST(request(
        JSON.stringify({ query: "show revenue" }),
        workspaceId,
        "custom",
      ));

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        code: "DATASET_NOT_FOUND",
        error: "The selected custom dataset is unavailable. Upload it again or explicitly select the demo dataset.",
      });
      expect(mocks.getDataset).toHaveBeenCalledWith(workspaceId);
      expect(mocks.loadDefaultData).not.toHaveBeenCalled();
      expect(mocks.parseQuery).not.toHaveBeenCalled();
    },
  );

  it("treats a legacy unknown workspace as custom instead of falling back to demo", async () => {
    mocks.getDataset.mockReturnValue(null);
    const response = await POST(request(
      JSON.stringify({ query: "show revenue" }),
      "legacy-workspace-123",
    ));

    expect(response.status).toBe(404);
    expect(mocks.loadDefaultData).not.toHaveBeenCalled();
    expect(mocks.parseQuery).not.toHaveBeenCalled();
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
    expect(mocks.getDataset).not.toHaveBeenCalled();
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
