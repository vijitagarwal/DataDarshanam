import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
  processDocumentEmbeddings: vi.fn(),
  GeminiEmbeddingProvider: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient }));
vi.mock("@/lib/embeddings/embeddingService", () => ({ processDocumentEmbeddings: mocks.processDocumentEmbeddings }));
vi.mock("@/lib/embeddings/gemini", () => ({ GeminiEmbeddingProvider: mocks.GeminiEmbeddingProvider }));

import { POST } from "./route";

const documentId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ documentId }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user: { id: "22222222-2222-4222-8222-222222222222" } });
  mocks.createServiceRoleSupabaseClient.mockReturnValue({});
  mocks.GeminiEmbeddingProvider.mockReturnValue({});
});

describe("document embeddings route", () => {
  it("requires authentication and invokes processing as the verified owner", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });
    expect((await POST(new Request("http://localhost"), context)).status).toBe(401);
    expect(mocks.processDocumentEmbeddings).not.toHaveBeenCalled();

    mocks.authenticateRequest.mockResolvedValue({ user: { id: "verified-user" } });
    mocks.processDocumentEmbeddings.mockResolvedValue({
      status: "ready",
      partCount: 3,
      reusedCount: 1,
    });
    const response = await POST(new Request("http://localhost", { method: "POST" }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ready", part_count: 3, reused_count: 1 });
    expect(mocks.processDocumentEmbeddings).toHaveBeenCalledWith({}, {}, documentId, "verified-user");
  });

  it("returns safe status codes without exposing provider errors", async () => {
    mocks.processDocumentEmbeddings.mockResolvedValue({ status: "not_found", partCount: 0, reusedCount: 0 });
    expect((await POST(new Request("http://localhost"), context)).status).toBe(404);

    mocks.processDocumentEmbeddings.mockResolvedValue({ status: "invalid_status", partCount: 0, reusedCount: 0 });
    expect((await POST(new Request("http://localhost"), context)).status).toBe(409);

    mocks.processDocumentEmbeddings.mockResolvedValue({
      status: "failed",
      partCount: 1,
      reusedCount: 0,
      errorCode: "RATE_LIMITED",
    });
    const response = await POST(new Request("http://localhost"), context);
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).not.toContain("provider");

    mocks.GeminiEmbeddingProvider.mockImplementation(() => {
      throw Object.assign(new Error("sensitive detail"), { code: "UNSAFE" });
    });
    const thrown = await POST(new Request("http://localhost"), context);
    expect(thrown.status).toBe(500);
    expect((await thrown.json()).error.message).not.toContain("sensitive");
  });
});
