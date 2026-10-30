import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  getBearerToken: vi.fn(),
  createUserSupabaseClient: vi.fn(),
  retrieveDocumentChunks: vi.fn(),
  generateGroundedAnswer: vi.fn(),
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
vi.mock("@/lib/groundedAnswer", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/groundedAnswer")>();
  return { ...actual, generateGroundedAnswer: mocks.generateGroundedAnswer };
});
vi.mock("@/lib/embeddings/gemini", () => ({
  GeminiEmbeddingProvider: mocks.GeminiEmbeddingProvider,
}));

import { POST } from "./route";

const evidence = [{
  documentId: "11111111-1111-4111-8111-111111111111",
  documentName: "Policy",
  chunkId: "33333333-3333-4333-8333-333333333333",
  chunkIndex: 0,
  text: "Leave is 20 days.",
  sourceStart: 0,
  sourceEnd: 17,
  pageStart: 1,
  pageEnd: 1,
  sectionPath: ["Leave"],
  similarity: 0.9,
}];

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/answers", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DOCUMENT_RAG_ANSWERS_ENABLED", "true");
  mocks.authenticateRequest.mockResolvedValue({ user: { id: "22222222-2222-4222-8222-222222222222" } });
  mocks.getBearerToken.mockReturnValue("verified-user-token");
  mocks.createUserSupabaseClient.mockReturnValue({ rpc: vi.fn() });
  mocks.GeminiEmbeddingProvider.mockImplementation(function () {
    return {};
  });
  mocks.retrieveDocumentChunks.mockResolvedValue(evidence);
  mocks.generateGroundedAnswer.mockResolvedValue({
    status: "answered",
    answer: "Leave is 20 days.",
    sources: [{
      documentId: evidence[0].documentId,
      documentName: evidence[0].documentName,
      chunkId: evidence[0].chunkId,
      chunkIndex: evidence[0].chunkIndex,
      sourceStart: evidence[0].sourceStart,
      sourceEnd: evidence[0].sourceEnd,
      pageStart: evidence[0].pageStart,
      pageEnd: evidence[0].pageEnd,
      sectionPath: evidence[0].sectionPath,
    }],
  });
});

describe("POST /api/answers", () => {
  it("keeps the endpoint disabled unless explicitly enabled", async () => {
    vi.stubEnv("DOCUMENT_RAG_ANSWERS_ENABLED", "false");
    const response = await POST(request({ question: "question" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: "FEATURE_DISABLED" },
    });
    expect(mocks.retrieveDocumentChunks).not.toHaveBeenCalled();
  });

  it("authenticates, reuses retrieval with user scope, and returns validated sources", async () => {
    const response = await POST(request({
      question: "How many leave days?",
      documentIds: [evidence[0].documentId],
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      status: "answered",
      answer: "Leave is 20 days.",
      sources: [{ chunkId: evidence[0].chunkId, pageStart: 1 }],
    });
    expect(mocks.createUserSupabaseClient).toHaveBeenCalledWith("verified-user-token");
    expect(mocks.retrieveDocumentChunks).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      "How many leave days?",
      [evidence[0].documentId],
      5,
    );
    expect(mocks.generateGroundedAnswer).toHaveBeenCalledWith("How many leave days?", evidence);
  });

  it("rejects unauthenticated and invalid requests before retrieval", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      error: true,
      code: "UNAUTHENTICATED",
      message: "Authentication is required.",
    });
    expect((await POST(request({ question: "question" }))).status).toBe(401);

    mocks.authenticateRequest.mockResolvedValue({ user: { id: "verified" } });
    expect((await POST(request({ question: " " }))).status).toBe(400);
    expect((await POST(request({ question: "x".repeat(5_001) }))).status).toBe(400);
    expect((await POST(request({ question: "question", documentIds: ["not-a-uuid"] }))).status).toBe(400);
    expect((await POST(request({ question: "question", isAdmin: true }))).status).toBe(400);
    expect(mocks.retrieveDocumentChunks).not.toHaveBeenCalled();
  });

  it("distinguishes no retrieved evidence and avoids a Groq call", async () => {
    mocks.retrieveDocumentChunks.mockResolvedValue([]);
    const response = await POST(request({ question: "question" }));
    expect(await response.json()).toEqual({
      success: true,
      status: "no_evidence",
      answer: null,
      sources: [],
    });
    expect(mocks.generateGroundedAnswer).not.toHaveBeenCalled();
  });

  it("returns the model's validated insufficient-evidence state separately", async () => {
    mocks.generateGroundedAnswer.mockResolvedValue({
      status: "insufficient_evidence",
      answer: "The retrieved documents do not provide enough information to answer this question.",
      sources: [],
    });
    const response = await POST(request({ question: "question" }));
    expect(await response.json()).toMatchObject({ status: "insufficient_evidence", sources: [] });
  });

  it("sanitizes retrieval/provider failures and bounds oversized requests", async () => {
    mocks.retrieveDocumentChunks.mockRejectedValue(new Error("private SQL error"));
    const failed = await POST(request({ question: "question" }));
    expect(failed.status).toBe(503);
    expect(JSON.stringify(await failed.json())).not.toContain("private SQL error");

    const large = request({ question: "x".repeat(21_000) });
    expect((await POST(large)).status).toBe(413);

    mocks.retrieveDocumentChunks.mockResolvedValue(evidence);
    mocks.generateGroundedAnswer.mockRejectedValue(new Error("Groq credential detail"));
    const providerFailure = await POST(request({ question: "question" }));
    expect(providerFailure.status).toBe(503);
    expect(JSON.stringify(await providerFailure.json())).not.toContain("Groq credential detail");
  });
});
