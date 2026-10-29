import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getDataset } from "@/lib/engine/dataEngine";

const mocks = vi.hoisted(() => ({
  parseQuery: vi.fn(),
  generateInsight: vi.fn(),
}));

vi.mock("@/lib/engine/llmParser", () => ({
  parseQuery: mocks.parseQuery,
}));
vi.mock("@/lib/engine/insightGen", () => ({
  generateInsight: mocks.generateInsight,
}));

import { POST as uploadCsv } from "./upload/route";
import { GET as getSchema } from "./schema/route";
import { POST as postQuery } from "./query/route";
import { POST as postDashboard } from "./dashboard/route";

const csv = [
  "product,revenue,region",
  "Laptop,1200,South",
  "Phone,800,North",
  "Tablet,500,South",
  "Laptop,1500,West",
  "Phone,950,North",
].join("\n");

const parsedQuery = {
  metric: "revenue",
  aggregation: "sum" as const,
  dimensions: ["product"],
  filters: [],
  chart_type: "bar" as const,
  sort_by: "metric",
  sort_order: "desc" as const,
  limit: 10,
  title: "Revenue by product",
  x_label: "Product",
  y_label: "Revenue",
};

function selectedRequest(
  url: string,
  method: "GET" | "POST",
  body?: string,
  workspaceId = "csv-regression-123",
) {
  return new NextRequest(url, {
    method,
    headers: {
      "X-Dataset-Mode": "custom",
      "X-Workspace-ID": workspaceId,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body } : {}),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("custom CSV upload-to-query flow", () => {
  it("aggregates the uploaded five-row CSV through the query API without demo fields", async () => {
    const workspaceId = `csv-regression-${crypto.randomUUID()}`;
    const formData = new FormData();
    formData.append("file", new File([csv], "datadarshanam_test_sales.csv", { type: "text/csv" }));
    const uploadRequest = new NextRequest("http://localhost/api/upload", {
      method: "POST",
      headers: { "X-Workspace-ID": workspaceId },
      body: formData,
    });

    const uploadResponse = await uploadCsv(uploadRequest);
    const uploadBody = await uploadResponse.json();
    expect(uploadResponse.status).toBe(200);
    expect(uploadBody).toMatchObject({
      success: true,
      filename: "datadarshanam_test_sales.csv",
      rows: 5,
      profile: { rows: 5, column_count: 3, numeric_columns: ["revenue"] },
    });

    mocks.parseQuery.mockResolvedValue(parsedQuery);
    mocks.generateInsight.mockResolvedValue({ insight: "Computed from the uploaded CSV.", fallback: false });

    const queryResponse = await postQuery(selectedRequest(
      "http://localhost/api/query",
      "POST",
      JSON.stringify({ query: "Show total revenue by product" }),
      workspaceId,
    ));
    const queryBody = await queryResponse.json();

    expect(queryResponse.status).toBe(200);
    expect(queryBody.success).toBe(true);
    expect(queryBody.result.data).toEqual([
      { product: "Laptop", revenue: 2700 },
      { product: "Phone", revenue: 1750 },
      { product: "Tablet", revenue: 500 },
    ]);
    expect(queryBody.result.summary).toMatchObject({
      total: 4950,
      max_label: "Laptop",
      max_value: 2700,
      row_count: 3,
    });
    expect(queryBody.plotly_spec.dark.data[0]).toMatchObject({
      x: ["Laptop", "Phone", "Tablet"],
      y: [2700, 1750, 500],
    });
    expect(JSON.stringify(queryBody)).not.toMatch(/product_id|total_revenue|1931|1087/);
    expect(mocks.parseQuery).toHaveBeenCalledWith(
      "Show total revenue by product",
      expect.arrayContaining([
        { product: "Laptop", revenue: 1200, region: "South" },
      ]),
      null,
    );
    expect(getDataset(workspaceId)).not.toBeNull();
  });

  it("rejects an upload without a workspace instead of writing to the demo key", async () => {
    const formData = new FormData();
    formData.append("file", new File([csv], "custom.csv", { type: "text/csv" }));
    const response = await uploadCsv(new NextRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_DATASET_SELECTION" });
  });

  it.each([
    ["schema", () => getSchema(selectedRequest("http://localhost/api/schema", "GET", undefined, "stale-csv-123"))],
    ["query", () => postQuery(selectedRequest(
      "http://localhost/api/query",
      "POST",
      JSON.stringify({ query: "Show revenue by product" }),
      "stale-csv-123",
    ))],
    ["dashboard", () => postDashboard(selectedRequest(
      "http://localhost/api/dashboard",
      "POST",
      JSON.stringify({ query: "generate full dashboard overview" }),
      "stale-csv-123",
    ))],
  ])("returns an explicit missing-custom-dataset error from the %s API", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "DATASET_NOT_FOUND",
      error: "The selected custom dataset is unavailable. Upload it again or explicitly select the demo dataset.",
    });
  });
});
