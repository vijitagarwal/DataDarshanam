import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { loadDefaultData } from "@/lib/engine/dataEngine";
import { MAX_CSV_BYTES } from "@/lib/engine/csv";

const mocks = vi.hoisted(() => ({
  parseQuery: vi.fn(),
  generateInsight: vi.fn(),
  authenticateRequest: vi.fn(),
  createUserDataset: vi.fn(),
  loadUserDatasetRows: vi.fn(),
  listUserDatasets: vi.fn(),
  deleteUserDataset: vi.fn(),
}));

vi.mock("@/lib/engine/llmParser", () => ({
  parseQuery: mocks.parseQuery,
  parseDashboardQuery: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/engine/insightGen", () => ({
  generateInsight: mocks.generateInsight,
}));
vi.mock("@/lib/engine/dataEngine", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/engine/dataEngine")>();
  return { ...actual, loadDefaultData: vi.fn(actual.loadDefaultData) };
});
vi.mock("@/lib/supabase/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock("@/lib/supabase/datasets", () => ({
  DatasetStoreError: class DatasetStoreError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  },
  createUserDataset: mocks.createUserDataset,
  loadUserDatasetRows: mocks.loadUserDatasetRows,
  listUserDatasets: mocks.listUserDatasets,
  deleteUserDataset: mocks.deleteUserDataset,
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

const userId = "user-a";
const datasetId = "6a4e1f90-27cb-4cc9-a3d0-8113fcb870a2";
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
  id = datasetId,
) {
  return new NextRequest(url, {
    method,
    headers: {
      "X-Dataset-Mode": "custom",
      "X-Dataset-ID": id,
      Authorization: "Bearer valid-token",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body } : {}),
  });
}

function streamedUploadRequest(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer verified",
      "content-type": "multipart/form-data; boundary=upload-boundary",
      ...headers,
    },
    body,
    duplex: "half",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user: { id: userId } });
  mocks.loadUserDatasetRows.mockResolvedValue({
    dataset: { id: datasetId, original_filename: "datadarshanam_test_sales.csv" },
    rows: [
      { product: "Laptop", revenue: 1200, region: "South" },
      { product: "Phone", revenue: 800, region: "North" },
      { product: "Tablet", revenue: 500, region: "South" },
      { product: "Laptop", revenue: 1500, region: "West" },
      { product: "Phone", revenue: 950, region: "North" },
    ],
  });
  mocks.createUserDataset.mockResolvedValue({
    id: datasetId,
    original_filename: "datadarshanam_test_sales.csv",
    file_size: csv.length,
    row_count: 5,
    column_count: 3,
    created_at: "2026-10-27T00:00:00.000Z",
  });
  mocks.listUserDatasets.mockResolvedValue([]);
  mocks.deleteUserDataset.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authenticated custom CSV flow", () => {
  it("persists an uploaded fixture and aggregates it through the existing query engine", async () => {
    const formData = new FormData();
    formData.append("file", new File([csv], "datadarshanam_test_sales.csv", { type: "text/csv" }));
    const uploadResponse = await uploadCsv(new NextRequest("http://localhost/api/upload", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
      body: formData,
    }));
    const uploadBody = await uploadResponse.json();

    expect(uploadResponse.status).toBe(201);
    expect(uploadBody).toMatchObject({
      success: true,
      dataset_id: datasetId,
      filename: "datadarshanam_test_sales.csv",
      rows: 5,
      profile: { rows: 5, column_count: 3, numeric_columns: ["revenue"] },
    });
    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.anything());
    expect(mocks.createUserDataset).toHaveBeenCalledWith(
      userId,
      "datadarshanam_test_sales.csv",
      expect.any(Uint8Array),
      expect.arrayContaining([{ product: "Laptop", revenue: 1200, region: "South" }]),
      expect.objectContaining({ rows: 5, column_count: 3 }),
    );

    mocks.parseQuery.mockResolvedValue(parsedQuery);
    mocks.generateInsight.mockResolvedValue({ insight: "Computed from the uploaded CSV.", fallback: false });
    const queryResponse = await postQuery(selectedRequest(
      "http://localhost/api/query",
      "POST",
      JSON.stringify({ query: "Show total revenue by product" }),
    ));
    const queryBody = await queryResponse.json();

    expect(queryResponse.status).toBe(200);
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
      expect.arrayContaining([{ product: "Laptop", revenue: 1200, region: "South" }]),
      null,
    );
    expect(mocks.loadUserDatasetRows).toHaveBeenCalledWith(userId, datasetId);
    expect(loadDefaultData).not.toHaveBeenCalled();
  });

  it("rejects custom uploads without a verified user", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });
    const formData = new FormData();
    formData.append("file", new File([csv], "custom.csv", { type: "text/csv" }));
    const response = await uploadCsv(new NextRequest("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(mocks.createUserDataset).not.toHaveBeenCalled();
  });

  it("rejects malformed CSV rather than persisting it", async () => {
    const formData = new FormData();
    formData.append("file", new File(["product,revenue\nLaptop\n"], "invalid.csv", { type: "text/csv" }));
    const response = await uploadCsv(new NextRequest("http://localhost/api/upload", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token" },
      body: formData,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_CSV" });
    expect(mocks.createUserDataset).not.toHaveBeenCalled();
  });

  it("rejects oversized requests before parsing the multipart body", async () => {
    const response = await uploadCsv(new NextRequest("http://localhost/api/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid-token",
        "content-length": String(25 * 1024 * 1024 + 65_537),
      },
      body: "",
    }));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "CSV_LIMIT_EXCEEDED" });
    expect(mocks.createUserDataset).not.toHaveBeenCalled();
  });

  it("enforces the body limit when Content-Length is absent", async () => {
    const maxRequestBytes = MAX_CSV_BYTES + 65_536;
    const response = await uploadCsv(streamedUploadRequest([
      new Uint8Array(maxRequestBytes),
      new Uint8Array(1),
    ], { "content-type": "application/octet-stream" }));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "CSV_LIMIT_EXCEEDED" });
    expect(mocks.createUserDataset).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid length syntax", { "content-length": "1.5" }],
    ["truncated declared body", { "content-length": "20" }],
  ])("rejects %s before processing an upload", async (_name, headers) => {
    const response = await uploadCsv(streamedUploadRequest(
      [new TextEncoder().encode("x")],
      { ...headers, "content-type": "application/octet-stream" },
    ));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_UPLOAD" });
    expect(mocks.createUserDataset).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed multipart data", async () => {
    const response = await uploadCsv(streamedUploadRequest([
      new TextEncoder().encode("--upload-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"incomplete.csv\"\r\n"),
    ]));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_UPLOAD" });
    expect(mocks.createUserDataset).not.toHaveBeenCalled();
  });

  it("handles concurrent bounded upload requests independently", async () => {
    const requests = Array.from({ length: 2 }, (_, index) => {
      const formData = new FormData();
      formData.append("file", new File([csv], `concurrent-${index}.csv`, { type: "text/csv" }));
      return uploadCsv(new NextRequest("http://localhost/api/upload", {
        method: "POST",
        headers: { Authorization: "Bearer verified" },
        body: formData,
      }));
    });

    const responses = await Promise.all(requests);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(mocks.createUserDataset).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["schema", () => getSchema(selectedRequest("http://localhost/api/schema", "GET", undefined, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))],
    ["query", () => postQuery(selectedRequest(
      "http://localhost/api/query",
      "POST",
      JSON.stringify({ query: "Show revenue by product" }),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ))],
    ["dashboard", () => postDashboard(selectedRequest(
      "http://localhost/api/dashboard",
      "POST",
      JSON.stringify({ query: "generate full dashboard overview" }),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ))],
  ])("returns an explicit missing-custom-dataset error from the %s API", async (_name, invoke) => {
    mocks.loadUserDatasetRows.mockResolvedValue(null);
    const response = await invoke();
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "DATASET_NOT_FOUND",
      error: "The selected custom dataset is unavailable. Select a saved dataset, upload a CSV, or explicitly select the demo dataset.",
    });
    expect(loadDefaultData).not.toHaveBeenCalled();
  });
});
