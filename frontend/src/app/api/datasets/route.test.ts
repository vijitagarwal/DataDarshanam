import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  listUserDatasets: vi.fn(),
  deleteUserDataset: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
}));
vi.mock("@/lib/supabase/datasets", () => ({
  DatasetStoreError: class DatasetStoreError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
  },
  listUserDatasets: mocks.listUserDatasets,
  deleteUserDataset: mocks.deleteUserDataset,
}));

import { DELETE } from "./[datasetId]/route";
import { GET } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const datasetId = "6a4e1f90-27cb-4cc9-a3d0-8113fcb870a2";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user: { id: userId } });
  mocks.listUserDatasets.mockResolvedValue([]);
  mocks.deleteUserDataset.mockResolvedValue(true);
});

describe("saved dataset routes", () => {
  it("requires authentication before listing", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });

    const response = await GET(new Request("http://localhost/api/datasets"));

    expect(response.status).toBe(401);
    expect(mocks.listUserDatasets).not.toHaveBeenCalled();
  });

  it("lists datasets only for the verified user", async () => {
    const response = await GET(new Request("http://localhost/api/datasets"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, datasets: [] });
    expect(mocks.listUserDatasets).toHaveBeenCalledWith(userId);
  });

  it("validates a delete request and passes only the verified owner ID", async () => {
    const response = await DELETE(new Request("http://localhost/api/datasets"), {
      params: Promise.resolve({ datasetId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.deleteUserDataset).toHaveBeenCalledWith(userId, datasetId);
  });

  it("returns not-found for an ID that is not owned by the signed-in user", async () => {
    mocks.deleteUserDataset.mockResolvedValue(false);
    const response = await DELETE(new Request("http://localhost/api/datasets"), {
      params: Promise.resolve({ datasetId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "DATASET_NOT_FOUND" },
    });
  });

  it("rejects malformed dataset IDs before calling storage", async () => {
    const response = await DELETE(new Request("http://localhost/api/datasets"), {
      params: Promise.resolve({ datasetId: "not-an-id" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.deleteUserDataset).not.toHaveBeenCalled();
  });
});
