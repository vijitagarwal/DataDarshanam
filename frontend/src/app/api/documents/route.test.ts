import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient }));

import { GET, POST } from "./route";

const user = { id: "11111111-1111-4111-8111-111111111111" };

function unauthorized() {
  return { error: true, code: "UNAUTHENTICATED", message: "Authentication is required." };
}

function request(body?: unknown) {
  return new Request("http://localhost/api/documents", {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user });
});

describe("document collection routes", () => {
  it("rejects unauthenticated listing and upload initialization", async () => {
    mocks.authenticateRequest.mockResolvedValue(unauthorized());

    const listing = await GET(request());
    const upload = await POST(request({
      filename: "policy.pdf",
      mediaType: "application/pdf",
      byteSize: 100,
    }));

    expect(listing.status).toBe(401);
    expect(upload.status).toBe(401);
    expect(mocks.createServiceRoleSupabaseClient).not.toHaveBeenCalled();
  });

  it("rejects invalid extensions, media types, and oversized uploads", async () => {
    const invalidExtension = await POST(request({
      filename: "policy.exe",
      mediaType: "application/octet-stream",
      byteSize: 100,
    }));
    const invalidMime = await POST(request({
      filename: "policy.pdf",
      mediaType: "text/plain",
      byteSize: 100,
    }));
    const oversized = await POST(request({
      filename: "policy.pdf",
      mediaType: "application/pdf",
      byteSize: 10 * 1024 * 1024 + 1,
    }));

    expect(invalidExtension.status).toBe(400);
    expect(invalidMime.status).toBe(400);
    expect(oversized.status).toBe(400);
    expect(mocks.createServiceRoleSupabaseClient).not.toHaveBeenCalled();
  });

  it("does not leak provider or database details during listing failures", async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { code: "secret-db-code", message: "secret database detail" } });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ success: false, error: { code: "DOCUMENT_LIST_FAILED", message: "Unable to list documents." } });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(eq).toHaveBeenCalledWith("user_id", user.id);
  });
});
