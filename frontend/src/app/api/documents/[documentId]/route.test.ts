import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient }));

import { DELETE, GET } from "./route";

const documentId = "11111111-1111-4111-8111-111111111111";
const user = { id: "22222222-2222-4222-8222-222222222222" };
const context = { params: Promise.resolve({ documentId }) };

function request() {
  return new Request("http://localhost/api/documents/" + documentId);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user });
});

describe("document ownership routes", () => {
  it("rejects unauthenticated status and deletion requests", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });

    expect((await GET(request(), context)).status).toBe(401);
    expect((await DELETE(request(), context)).status).toBe(401);
    expect(mocks.createServiceRoleSupabaseClient).not.toHaveBeenCalled();
  });

  it("treats another user's document as not found for status and deletion", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eqUser = vi.fn().mockReturnValue({ maybeSingle });
    const eqDocument = vi.fn().mockReturnValue({ eq: eqUser });
    const select = vi.fn().mockReturnValue({ eq: eqDocument });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    });

    expect((await GET(request(), context)).status).toBe(404);
    expect((await DELETE(request(), context)).status).toBe(404);
    expect(eqDocument).toHaveBeenCalledWith("id", documentId);
    expect(eqUser).toHaveBeenCalledWith("user_id", user.id);
  });

  it("rejects malformed document identifiers before database access", async () => {
    const invalidContext = { params: Promise.resolve({ documentId: "../other-user-document" }) };
    const response = await GET(request(), invalidContext);

    expect(response.status).toBe(404);
    expect(mocks.createServiceRoleSupabaseClient).not.toHaveBeenCalled();
  });
});
