import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  return {
    getUser,
    createUserSupabaseClient: vi.fn(() => ({ auth: { getUser } })),
  };
});

vi.mock("./server", () => ({ createUserSupabaseClient: mocks.createUserSupabaseClient }));

import { authenticateRequest, getBearerToken } from "./auth";

describe("Supabase request authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts only a well-formed bearer token", () => {
    expect(getBearerToken(new Request("http://localhost"))).toBeNull();
    expect(getBearerToken(new Request("http://localhost", {
      headers: { Authorization: "Basic token" },
    }))).toBeNull();
    expect(getBearerToken(new Request("http://localhost", {
      headers: { Authorization: "Bearer user-token" },
    }))).toBe("user-token");
  });

  it("rejects missing and invalid credentials without exposing provider details", async () => {
    const missing = await authenticateRequest(new Request("http://localhost"));
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("secret provider detail") });
    const invalid = await authenticateRequest(new Request("http://localhost", {
      headers: { Authorization: "Bearer invalid" },
    }));

    expect(missing).toEqual({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });
    expect(invalid).toEqual(missing);
  });

  it("returns the verified user and passes the token to Supabase", async () => {
    const user = { id: "user-a", aud: "authenticated" };
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });

    const result = await authenticateRequest(new Request("http://localhost", {
      headers: { Authorization: "Bearer valid-token" },
    }));

    expect(result).toEqual({ user });
    expect(mocks.createUserSupabaseClient).toHaveBeenCalledWith("valid-token");
    expect(mocks.getUser).toHaveBeenCalledWith("valid-token");
  });
});
