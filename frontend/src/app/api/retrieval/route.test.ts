import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getBearerToken: vi.fn(),
  createUserSupabaseClient: vi.fn(),
  retrieveDocumentChunks: vi.fn(),
  GeminiEmbeddingProvider: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({
  authenticateRequest: mocks.authenticateRequest,
  getBearerToken: mocks.getBearerToken,
}));
vi.mock("@/lib/supabase/server", () => ({
  createUserSupabaseClient: mocks.createUserSupabaseClient,
}));
vi.mock("@/lib/embeddings/retrievalService", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/embeddings/retrievalService")>();
  return { ...actual, retrieveDocumentChunks: mocks.retrieveDocumentChunks };
});
vi.mock("@/lib/embeddings/gemini", () => ({
  GeminiEmbeddingProvider: mocks.GeminiEmbeddingProvider,
}));

import { POST } from "./route";

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/retrieval", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user: { id: "22222222-2222-4222-8222-222222222222" } });
  mocks.getBearerToken.mockReturnValue("verified-access-token");
  mocks.createUserSupabaseClient.mockReturnValue({ rpc: vi.fn() });
  mocks.GeminiEmbeddingProvider.mockImplementation(function () {
    return {};
  });
  mocks.retrieveDocumentChunks.mockResolvedValue([]);
});

describe("POST /api/retrieval", () => {
  it("requires authentication and uses the user-token database client", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });
    expect((await POST(request({ query: "question" }))).status).toBe(401);
    expect(mocks.retrieveDocumentChunks).not.toHaveBeenCalled();

    mocks.authenticateRequest.mockResolvedValue({ user: { id: "22222222-2222-4222-8222-222222222222" } });
    const response = await POST(request({ query: "question" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, status: "no_matches", matches: [] });
    expect(mocks.createUserSupabaseClient).toHaveBeenCalledWith("verified-access-token");
    expect(mocks.retrieveDocumentChunks).toHaveBeenCalledWith(
      expect.any(Object), expect.any(Object), "question", undefined, 5,
    );
  });

  it("rejects invalid inputs without creating a provider or calling retrieval", async () => {
    expect((await POST(request({ query: "  " }))).status).toBe(400);
    expect((await POST(request({ query: "valid", documentIds: ["someone-else"] }))).status).toBe(400);
    expect((await POST(request({ query: "valid", limit: 0 }))).status).toBe(400);
    expect(mocks.GeminiEmbeddingProvider).not.toHaveBeenCalled();
    expect(mocks.retrieveDocumentChunks).not.toHaveBeenCalled();
  });

  it("returns source metadata and maps retrieval failures without leaking details", async () => {
    mocks.retrieveDocumentChunks.mockResolvedValue([{
      documentId: "11111111-1111-4111-8111-111111111111",
      documentName: "Policies",
      chunkId: "33333333-3333-4333-8333-333333333333",
      chunkIndex: 2,
      text: "canonical source",
      sourceStart: 10,
      sourceEnd: 26,
      pageStart: 1,
      pageEnd: 1,
      sectionPath: ["Benefits"],
      similarity: 0.8,
    }]);
    const response = await POST(request({ query: "benefits", limit: 1 }));
    expect(await response.json()).toMatchObject({
      status: "matches",
      matches: [{ documentId: "11111111-1111-4111-8111-111111111111", sourceStart: 10, sourceEnd: 26 }],
    });

    mocks.retrieveDocumentChunks.mockRejectedValue(new Error("private provider/database detail"));
    const failed = await POST(request({ query: "benefits" }));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("private provider/database detail");
  });
});
