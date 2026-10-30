import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDefaultData } from "./dataEngine";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  loadUserDatasetRows: vi.fn(),
}));

vi.mock("./dataEngine", async importOriginal => {
  const actual = await importOriginal<typeof import("./dataEngine")>();
  return { ...actual, loadDefaultData: vi.fn() };
});
vi.mock("@/lib/supabase/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/datasets", () => ({
  DatasetStoreError: class DatasetStoreError extends Error {},
  loadUserDatasetRows: mocks.loadUserDatasetRows,
}));

import { resolveRequestDataset } from "./datasetSelection";

const datasetId = "6a4e1f90-27cb-4cc9-a3d0-8113fcb870a2";
const demoRows = [{ product_id: 1931, total_revenue: 1_200 }];
const customRows = [{ product: "Laptop", revenue: 2_700 }];

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/schema", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadDefaultData).mockResolvedValue(demoRows);
  mocks.authenticateRequest.mockResolvedValue({ user: { id: "user-a" } });
  mocks.loadUserDatasetRows.mockResolvedValue({
    dataset: { id: datasetId, original_filename: "sales.csv" },
    rows: customRows,
  });
});

describe("request dataset selection", () => {
  it("loads the bundled dataset only for explicit demo mode", async () => {
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "demo",
    }))).resolves.toEqual({ rows: demoRows, mode: "demo" });

    expect(loadDefaultData).toHaveBeenCalledOnce();
    expect(mocks.loadUserDatasetRows).not.toHaveBeenCalled();
  });

  it("keeps the no-selection demo request working", async () => {
    await expect(resolveRequestDataset(request())).resolves.toEqual({
      rows: demoRows,
      mode: "demo",
    });
    expect(loadDefaultData).toHaveBeenCalledOnce();
  });

  it("requires a real dataset ID for custom selection", async () => {
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "custom",
    }))).rejects.toMatchObject({ code: "DATASET_NOT_FOUND", status: 404 });
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "custom",
      "X-Dataset-ID": "not-a-uuid",
    }))).rejects.toMatchObject({ code: "INVALID_DATASET_SELECTION", status: 400 });
    expect(loadDefaultData).not.toHaveBeenCalled();
    expect(mocks.loadUserDatasetRows).not.toHaveBeenCalled();
  });

  it("loads the saved dataset using the authenticated user and dataset ID", async () => {
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "custom",
      "X-Dataset-ID": datasetId,
      Authorization: "Bearer valid-token",
    }))).resolves.toEqual({
      rows: customRows,
      mode: "custom",
      dataset: { id: datasetId, original_filename: "sales.csv" },
    });
    expect(mocks.authenticateRequest).toHaveBeenCalledOnce();
    expect(mocks.loadUserDatasetRows).toHaveBeenCalledWith("user-a", datasetId);
    expect(loadDefaultData).not.toHaveBeenCalled();
  });

  it("fails closed for missing or unowned datasets", async () => {
    mocks.loadUserDatasetRows.mockResolvedValue(null);
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "custom",
      "X-Dataset-ID": datasetId,
    }))).rejects.toMatchObject({ code: "DATASET_NOT_FOUND", status: 404 });
    expect(loadDefaultData).not.toHaveBeenCalled();
  });

  it("requires authentication for a saved custom dataset", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "custom",
      "X-Dataset-ID": datasetId,
    }))).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(mocks.loadUserDatasetRows).not.toHaveBeenCalled();
    expect(loadDefaultData).not.toHaveBeenCalled();
  });

  it("treats a legacy workspace as missing custom data, never as demo data", async () => {
    await expect(resolveRequestDataset(request({
      "X-Workspace-ID": "legacy-workspace-123",
    }))).rejects.toMatchObject({ code: "DATASET_NOT_FOUND", status: 404 });
    expect(loadDefaultData).not.toHaveBeenCalled();
  });

  it("rejects invalid dataset modes", async () => {
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "other",
    }))).rejects.toMatchObject({ code: "INVALID_DATASET_SELECTION", status: 400 });
    expect(loadDefaultData).not.toHaveBeenCalled();
  });
});
