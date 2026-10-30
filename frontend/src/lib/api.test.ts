import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBrowserSupabaseClient: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("./supabase/browser", () => ({
  getBrowserSupabaseClient: mocks.getBrowserSupabaseClient,
}));

import {
  fetchSchema,
  fetchUserDatasets,
  selectCustomDataset,
  selectDemoDataset,
} from "./api";

const values = new Map<string, string>();
const storage = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  removeItem: vi.fn((key: string) => { values.delete(key); }),
};

beforeEach(() => {
  vi.clearAllMocks();
  values.clear();
  vi.stubGlobal("window", {
    localStorage: storage,
    setTimeout,
    clearTimeout,
  });
  mocks.getSession.mockResolvedValue({
    data: { session: { access_token: "verified-session-token" } },
    error: null,
  });
  mocks.getBrowserSupabaseClient.mockReturnValue({ auth: { getSession: mocks.getSession } });
});

describe("dataset API client selection", () => {
  it("uses explicit demo mode without a workspace ID or bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      profile: { rows: 0 },
      suggested_questions: [],
    })));
    vi.stubGlobal("fetch", fetchMock);
    selectDemoDataset();

    await fetchSchema();

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("X-Dataset-Mode")).toBe("demo");
    expect(headers.get("X-Dataset-ID")).toBeNull();
    expect(headers.get("X-Workspace-ID")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
  });

  it("sends the selected dataset ID and Supabase access token for custom queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      profile: { rows: 1 },
      suggested_questions: [],
    })));
    vi.stubGlobal("fetch", fetchMock);
    selectCustomDataset("6a4e1f90-27cb-4cc9-a3d0-8113fcb870a2", "sales.csv");

    await fetchSchema();

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("X-Dataset-Mode")).toBe("custom");
    expect(headers.get("X-Dataset-ID")).toBe("6a4e1f90-27cb-4cc9-a3d0-8113fcb870a2");
    expect(headers.get("Authorization")).toBe("Bearer verified-session-token");
  });

  it("fails closed when custom mode has no selected dataset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("datadarshan-dataset-mode", "custom");

    await expect(fetchSchema()).rejects.toThrow(/No saved CSV is selected/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authenticates dataset listing even when no custom dataset is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      datasets: [],
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchUserDatasets()).resolves.toEqual([]);

    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("Authorization")).toBe("Bearer verified-session-token");
    expect(headers.get("X-Dataset-ID")).toBeNull();
  });
});
