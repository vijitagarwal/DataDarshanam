import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("./server", () => ({
  createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient,
}));

import {
  createUserDataset,
  deleteUserDataset,
  listUserDatasets,
  loadUserDatasetRows,
} from "./datasets";

const datasetId = "6a4e1f90-27cb-4cc9-a3d0-8113fcb870a2";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("owned dataset storage", () => {
  it("scopes dataset lookup to both its ID and verified owner", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    const client = { from: vi.fn(() => query) };
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);

    await expect(loadUserDatasetRows("user-b", datasetId)).resolves.toBeNull();
    expect(query.eq).toHaveBeenNthCalledWith(1, "id", datasetId);
    expect(query.eq).toHaveBeenNthCalledWith(2, "user_id", "user-b");
    expect(query.in).toHaveBeenCalledWith("status", ["ready"]);
  });

  it("reloads persisted CSV rows from private Storage on a later request", async () => {
    const record = {
      id: datasetId,
      user_id: "user-a",
      original_filename: "sales.csv",
      file_size: 28,
      row_count: 1,
      column_count: 2,
      created_at: "2026-10-27T00:00:00.000Z",
      storage_bucket: "datasets",
      storage_path: `user-a/${datasetId}.csv`,
      status: "ready",
      schema: {},
    };
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: record, error: null }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    const download = vi.fn().mockResolvedValue({
      data: new Blob(["product,revenue\nLaptop,2700\n"], { type: "text/csv" }),
      error: null,
    });
    const client = {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ download })) },
    };
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);

    await expect(loadUserDatasetRows("user-a", datasetId)).resolves.toMatchObject({
      dataset: { id: datasetId, original_filename: "sales.csv" },
      rows: [{ product: "Laptop", revenue: 2700 }],
    });
    expect(download).toHaveBeenCalledWith(`user-a/${datasetId}.csv`);
  });

  it("lists only ready datasets for the verified owner", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.order.mockResolvedValue({
      data: [{
        id: datasetId,
        user_id: "user-a",
        original_filename: "sales.csv",
        file_size: 30,
        row_count: 2,
        column_count: 2,
        created_at: "2026-10-27T00:00:00.000Z",
        storage_bucket: "datasets",
        storage_path: `user-a/${datasetId}.csv`,
        status: "ready",
        schema: {},
      }],
      error: null,
    });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({ from: vi.fn(() => query) });

    await expect(listUserDatasets("user-a")).resolves.toEqual([{
      id: datasetId,
      original_filename: "sales.csv",
      file_size: 30,
      row_count: 2,
      column_count: 2,
      created_at: "2026-10-27T00:00:00.000Z",
      status: "ready",
    }]);
    expect(query.eq).toHaveBeenNthCalledWith(1, "user_id", "user-a");
    expect(query.in).toHaveBeenCalledWith("status", ["uploading", "ready", "failed", "deleting"]);
  });

  it("reserves owner-scoped quota before private upload and marks the record ready", async () => {
    const rpcArgs: { current: Record<string, unknown> | null } = { current: null };
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn(),
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.single.mockImplementation(async () => ({
      data: {
        id: rpcArgs.current?.p_dataset_id,
        user_id: "user-a",
        original_filename: "sales.csv",
        file_size: 28,
        row_count: 1,
        column_count: 2,
        created_at: "2026-10-27T00:00:00.000Z",
        storage_bucket: "datasets",
        storage_path: `user-a/${rpcArgs.current?.p_dataset_id}.csv`,
        status: "ready",
        schema: {},
      },
      error: null,
    }));
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = {
      rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
        rpcArgs.current = args;
        return { error: null };
      }),
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ upload })) },
    };
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);

    const rows = [{ product: "Laptop", revenue: 2700 }];
    const dataset = await createUserDataset(
      "user-a",
      "sales.csv",
      new TextEncoder().encode("product,revenue\nLaptop,2700\n"),
      rows,
      {
        rows: 1,
        column_count: 2,
        columns: [],
        numeric_columns: ["revenue"],
        categorical_columns: ["product"],
        date_columns: [],
        text_columns: [],
      },
    );

    expect(client.rpc).toHaveBeenCalledWith("reserve_user_dataset", expect.objectContaining({
      p_user_id: "user-a",
      p_original_filename: "sales.csv",
      p_file_size: 28,
    }));
    expect(rpcArgs.current?.p_storage_path).toBe(`user-a/${dataset.id}.csv`);
    expect(upload).toHaveBeenCalledWith(
      `user-a/${dataset.id}.csv`,
      expect.any(Buffer),
      { contentType: "text/csv", upsert: false },
    );
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(dataset.id).toBe(rpcArgs.current?.p_dataset_id);
  });

  it("maps the database quota response without attempting Storage upload", async () => {
    const upload = vi.fn();
    mocks.createServiceRoleSupabaseClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ error: { code: "54000" } }),
      storage: { from: vi.fn(() => ({ upload })) },
    });

    await expect(createUserDataset(
      "user-a",
      "sales.csv",
      new Uint8Array([1]),
      [{ product: "Laptop" }],
      {
        rows: 1,
        column_count: 1,
        columns: [],
        numeric_columns: [],
        categorical_columns: [],
        date_columns: [],
        text_columns: ["product"],
      },
    )).rejects.toMatchObject({ code: "DATASET_QUOTA_EXCEEDED" });
    expect(upload).not.toHaveBeenCalled();
  });

  it("only uploads the concurrent reservation admitted by the quota RPC", async () => {
    let reservations = 0;
    const query = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: datasetId,
          user_id: "user-a",
          original_filename: "sales.csv",
          file_size: 28,
          row_count: 1,
          column_count: 2,
          created_at: "2026-10-27T00:00:00.000Z",
          storage_bucket: "datasets",
          storage_path: `user-a/${datasetId}.csv`,
          status: "ready",
          schema: {},
        },
        error: null,
      }),
    };
    query.update.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.select.mockReturnValue(query);
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = {
      rpc: vi.fn(async () => {
        reservations += 1;
        return reservations === 1 ? { error: null } : { error: { code: "54000" } };
      }),
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ upload })) },
    };
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);

    const args: Parameters<typeof createUserDataset> = [
      "user-a",
      "sales.csv",
      new TextEncoder().encode("product,revenue\nLaptop,2700\n"),
      [{ product: "Laptop", revenue: 2700 }],
      {
        rows: 1,
        column_count: 2,
        columns: [],
        numeric_columns: ["revenue"],
        categorical_columns: ["product"],
        date_columns: [],
        text_columns: [],
      },
    ];
    const results = await Promise.allSettled([
      createUserDataset(...args),
      createUserDataset(...args),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(upload).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("removes a partial object and its reservation after Storage upload failure", async () => {
    const query = {
      delete: vi.fn(),
      eq: vi.fn(),
      then: (resolve: (value: { error: null }) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    query.delete.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const upload = vi.fn().mockResolvedValue({ error: { name: "StorageError" } });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = {
      rpc: vi.fn().mockResolvedValue({ error: null }),
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ upload, remove })) },
    };
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);

    await expect(createUserDataset(
      "user-a",
      "sales.csv",
      new TextEncoder().encode("product,revenue\nLaptop,2700\n"),
      [{ product: "Laptop", revenue: 2700 }],
      {
        rows: 1,
        column_count: 2,
        columns: [],
        numeric_columns: ["revenue"],
        categorical_columns: ["product"],
        date_columns: [],
        text_columns: [],
      },
    )).rejects.toMatchObject({ code: "DATASET_STORE_FAILED" });

    const reservedPath = String(client.rpc.mock.calls[0][1].p_storage_path);
    expect(remove).toHaveBeenCalledWith([reservedPath]);
    expect(query.delete).toHaveBeenCalledOnce();
    expect(query.eq).toHaveBeenCalledWith("status", "uploading");
  });

  it("deletes only an owner-scoped dataset object and its metadata", async () => {
    const record = {
      id: datasetId,
      user_id: "user-a",
      original_filename: "sales.csv",
      file_size: 28,
      row_count: 1,
      column_count: 2,
      created_at: "2026-10-27T00:00:00.000Z",
      storage_bucket: "datasets",
      storage_path: `user-a/${datasetId}.csv`,
      status: "ready",
      schema: {},
    };
    const query: {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      in: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      then: (resolve: (value: { error: null }) => unknown) => Promise<unknown>;
    } = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: record, error: null })
        .mockResolvedValueOnce({ data: { id: datasetId }, error: null }),
      update: vi.fn(),
      delete: vi.fn(),
      then: (resolve) => Promise.resolve({ error: null }).then(resolve),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.in.mockReturnValue(query);
    query.update.mockReturnValue(query);
    query.delete.mockReturnValue(query);
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn(() => query),
      storage: { from: vi.fn(() => ({ remove })) },
    };
    mocks.createServiceRoleSupabaseClient.mockReturnValue(client);

    await expect(deleteUserDataset("user-a", datasetId)).resolves.toBe(true);
    expect(query.eq).toHaveBeenCalledWith("user_id", "user-a");
    expect(remove).toHaveBeenCalledWith([`user-a/${datasetId}.csv`]);
    expect(query.delete).toHaveBeenCalledOnce();
  });
});
