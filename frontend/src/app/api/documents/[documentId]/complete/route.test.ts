import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient }));

import { POST } from "./route";

const documentId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ documentId }) };
const user = { id: "22222222-2222-4222-8222-222222222222" };

function request(body?: unknown) {
  return new Request("http://localhost/api/documents/" + documentId + "/complete", {
    method: "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user });
});

describe("document completion route", () => {
  it("rejects unauthenticated and malformed completion requests", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });
    expect((await POST(request(), context)).status).toBe(401);

    mocks.authenticateRequest.mockResolvedValue({ user });
    expect((await POST(request({ sha256: "not-a-hash" }), context)).status).toBe(400);
  });

  it("returns an idempotent response for an already queued document", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: documentId, status: "queued", storage_path: "ignored", byte_size: 100, sha256: null },
      error: null,
    });
    const eqUser = vi.fn().mockReturnValue({ maybeSingle });
    const eqDocument = vi.fn().mockReturnValue({ eq: eqUser });
    const select = vi.fn().mockReturnValue({ eq: eqDocument });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    });

    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: "queued", idempotent: true });
  });

  it("returns a retryable error when the uploaded object is absent", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: documentId, status: "awaiting_upload", storage_path: `${user.id}/${documentId}/original.pdf`, byte_size: 100, sha256: null },
      error: null,
    });
    const eqUser = vi.fn().mockReturnValue({ maybeSingle });
    const eqDocument = vi.fn().mockReturnValue({ eq: eqUser });
    const select = vi.fn().mockReturnValue({ eq: eqDocument });
    mocks.createServiceRoleSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
      storage: { from: vi.fn().mockReturnValue({ list: vi.fn().mockResolvedValue({ data: [], error: null }) }) },
    });

    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "UPLOAD_NOT_FOUND" } });
  });
});
