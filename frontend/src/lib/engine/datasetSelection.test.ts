import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadDefaultData, getDataset } from "./dataEngine";

vi.mock("./dataEngine", async importOriginal => {
  const actual = await importOriginal<typeof import("./dataEngine")>();
  return {
    ...actual,
    getDataset: vi.fn(),
    loadDefaultData: vi.fn(),
  };
});

import { resolveRequestDataset } from "./datasetSelection";

const demoRows = [{ product_id: 1931, total_revenue: 1_200 }];
const customRows = [{ product: "Laptop", revenue: 2_700 }];

function request(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/schema", { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDataset).mockReturnValue(customRows);
  vi.mocked(loadDefaultData).mockResolvedValue(demoRows);
});

describe("request dataset selection", () => {
  it("loads the bundled dataset only for explicit demo mode", async () => {
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "demo",
    }))).resolves.toEqual({ rows: demoRows, mode: "demo" });

    expect(loadDefaultData).toHaveBeenCalledOnce();
    expect(getDataset).not.toHaveBeenCalled();
  });

  it("keeps the legacy no-workspace demo request working", async () => {
    await expect(resolveRequestDataset(request())).resolves.toEqual({
      rows: demoRows,
      mode: "demo",
    });
    expect(loadDefaultData).toHaveBeenCalledOnce();
  });

  it("requires a workspace for an explicit custom selection", async () => {
    await expect(resolveRequestDataset(request({
      "X-Dataset-Mode": "custom",
    }))).rejects.toMatchObject({ code: "INVALID_DATASET_SELECTION", status: 400 });
    expect(loadDefaultData).not.toHaveBeenCalled();
  });

  it.each(["stale-workspace-123", "unknown-workspace-123"])(
    "returns not found instead of demo data for missing custom workspace %s",
    async workspaceId => {
      vi.mocked(getDataset).mockReturnValue(null);

      await expect(resolveRequestDataset(request({
        "X-Dataset-Mode": "custom",
        "X-Workspace-ID": workspaceId,
      }))).rejects.toMatchObject({ code: "DATASET_NOT_FOUND", status: 404 });

      expect(getDataset).toHaveBeenCalledWith(workspaceId);
      expect(loadDefaultData).not.toHaveBeenCalled();
    },
  );

  it("treats a legacy unknown workspace as custom, not as demo", async () => {
    vi.mocked(getDataset).mockReturnValue(null);

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
