import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedContent: vi.fn(),
  countTokens: vi.fn(),
  GoogleGenAI: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: mocks.GoogleGenAI,
}));

import { GeminiEmbeddingProvider } from "./gemini";

const vector = Array.from({ length: 128 }, (_, index) => index + 1);
const providerError = (status: number, code?: string) => Object.assign(new Error("sensitive provider detail"), {
  status,
  code,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countTokens.mockImplementation(async ({ contents }: { contents: string }) => ({
    totalTokens: Array.from(contents).length,
  }));
  mocks.GoogleGenAI.mockImplementation(() => ({
    models: {
      embedContent: mocks.embedContent,
      countTokens: mocks.countTokens,
    },
  }));
});

describe("GeminiEmbeddingProvider", () => {
  it("counts exact formatted document/query inputs and preserves embedding identity", async () => {
    mocks.embedContent
      .mockResolvedValueOnce({ embeddings: [{ values: vector }] })
      .mockResolvedValueOnce({ embeddings: [{ values: vector }] });
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      dimension: 128,
      model: "gemini-embedding-001",
    });

    const documents = await provider.embedDocuments([{ id: "chunk-1", title: "Policy", text: "Retention is seven years." }]);
    const query = await provider.embedQuery("How long is retention?");

    expect(documents[0]).toMatchObject({ inputId: "chunk-1" });
    expect(documents[0].values).toHaveLength(128);
    expect(query.values).toHaveLength(128);
    expect(mocks.countTokens).toHaveBeenNthCalledWith(1, {
      model: "gemini-embedding-001",
      contents: "title: Policy | text: Retention is seven years.",
    });
    expect(mocks.embedContent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      model: "gemini-embedding-001",
      config: { taskType: "RETRIEVAL_DOCUMENT", outputDimensionality: 128 },
    }));
    expect(mocks.embedContent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      contents: "task: search result | query: How long is retention?",
      config: { taskType: "RETRIEVAL_QUERY", outputDimensionality: 128 },
    }));
    expect(provider.getIdentity()).toMatchObject({
      provider: "google-gemini",
      dimension: 128,
      normalization: "l2-unit-v1",
      version: "google-gemini/gemini-embedding-001/retrieval-v1/dim-128/norm-l2-v1",
    });
    expect(Math.hypot(...documents[0].values)).toBeCloseTo(1, 6);
    expect(Math.hypot(...query.values)).toBeCloseTo(1, 6);
  });

  it("splits token-oversized documents and maps derived vectors to exact source offsets", async () => {
    mocks.countTokens.mockImplementation(async ({ contents }: { contents: string }) => ({
      totalTokens: contents.slice(contents.indexOf("| text: ") + 8).length,
    }));
    mocks.embedContent.mockResolvedValue({
      embeddings: Array.from({ length: 3 }, () => ({ values: vector })),
    });
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      dimension: 128,
      maxInputTokens: 4,
    });
    const text = "abcdefghij";
    const results = await provider.embedDocuments([{
      id: "chunk-1",
      text,
      sourceStart: 10,
      sourceEnd: 20,
      documentId: "doc-1",
      ownerId: "user-1",
      pageStart: 2,
      pageEnd: 2,
      sectionPath: ["Heading"],
    }]);

    expect(results.map(result => result.values)).toHaveLength(3);
    expect(results.map(result => result.inputId)).toEqual([
      "chunk-1:part-0", "chunk-1:part-1", "chunk-1:part-2",
    ]);
    expect(results.map(result => [result.sourceStart, result.sourceEnd])).toEqual([
      [10, 14], [14, 18], [18, 20],
    ]);
    for (const result of results) {
      expect(text.slice(result.sourceStart! - 10, result.sourceEnd! - 10).length).toBeGreaterThan(0);
      expect(result).toMatchObject({ documentId: "doc-1", ownerId: "user-1", pageStart: 2, sectionPath: ["Heading"] });
    }
    expect(mocks.embedContent).toHaveBeenCalledTimes(1);
    expect(mocks.embedContent.mock.calls[0][0].contents).toHaveLength(3);
  });

  it("enforces the aggregate request token budget while retaining deterministic input mapping", async () => {
    mocks.countTokens.mockImplementation(async ({ contents }: { contents: string }) => ({
      totalTokens: contents.endsWith("aa") ? 6 : 6,
    }));
    mocks.embedContent.mockImplementation(async ({ contents }: { contents: unknown[] }) => ({
      embeddings: contents.map((_, index) => ({ values: vector.map(value => value + index) })),
    }));
    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      dimension: 128,
      maxInputTokens: 8,
      maxRequestTokens: 12,
    });
    const results = await provider.embedDocuments([
      { id: "one", text: "aa" },
      { id: "two", text: "bb" },
      { id: "three", text: "cc" },
    ]);

    expect(mocks.embedContent).toHaveBeenCalledTimes(2);
    expect(results.map(result => result.inputId)).toEqual(["one", "two", "three"]);
    expect(results[0].values[0]).toBeCloseTo(results[2].values[0], 12);
    expect(results[1].values[0]).not.toBeCloseTo(results[0].values[0], 12);
    expect(results.every(result => Math.abs(Math.hypot(...result.values) - 1) < 1e-6)).toBe(true);
  });

  it("rejects invalid configuration, over-limit queries, and malformed vectors", async () => {
    expect(() => new GeminiEmbeddingProvider({ apiKey: " " })).toThrow("not configured");
    expect(() => new GeminiEmbeddingProvider({
      apiKey: "test-key",
      maxInputTokens: 2_049,
      maxRequestTokens: 2_048,
    })).toThrow("token limits are invalid");

    const provider = new GeminiEmbeddingProvider({
      apiKey: "test-key",
      dimension: 128,
      maxInputTokens: 3,
    });
    await expect(provider.embedQuery("long query")).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    mocks.countTokens.mockResolvedValue({ totalTokens: 1 });
    mocks.embedContent.mockResolvedValue({ embeddings: [{ values: [1, 2] }] });
    await expect(provider.embedQuery("q")).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("fails closed on token-count failures and retries a transient timeout only within bounds", async () => {
    const provider = new GeminiEmbeddingProvider({ apiKey: "test-key", dimension: 128, maxRetries: 1 });
    mocks.countTokens.mockRejectedValueOnce(Object.assign(new Error("private detail"), { status: 401 }));
    await expect(provider.embedQuery("q")).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(mocks.embedContent).not.toHaveBeenCalled();

    mocks.countTokens
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }))
      .mockResolvedValueOnce({ totalTokens: 1 });
    mocks.embedContent.mockResolvedValueOnce({ embeddings: [{ values: vector }] });
    await expect(provider.embedQuery("q")).resolves.toMatchObject({ values: expect.any(Array) });
    expect(mocks.countTokens).toHaveBeenCalledTimes(3);
  });

  it("does not retry exhausted quota and sanitizes provider failures", async () => {
    const provider = new GeminiEmbeddingProvider({ apiKey: "test-key", dimension: 128, maxRetries: 2 });
    mocks.countTokens.mockRejectedValue(Object.assign(new Error("private quota response"), {
      status: 429,
      code: "RESOURCE_EXHAUSTED",
    }));
    await expect(provider.embedQuery("q")).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      message: "Embedding provider quota is exhausted.",
    });
    expect(mocks.countTokens).toHaveBeenCalledTimes(1);
    expect(mocks.embedContent).not.toHaveBeenCalled();
  });

  it("retries rate limits only up to the configured retry count and sanitizes the response", async () => {
    const provider = new GeminiEmbeddingProvider({ apiKey: "test-key", dimension: 128, maxRetries: 1 });
    mocks.countTokens
      .mockRejectedValueOnce(providerError(429))
      .mockResolvedValueOnce({ totalTokens: 1 });
    mocks.embedContent.mockResolvedValueOnce({ embeddings: [{ values: vector }] });

    await expect(provider.embedQuery("q")).resolves.toMatchObject({ values: expect.any(Array) });
    expect(mocks.countTokens).toHaveBeenCalledTimes(2);

    mocks.countTokens.mockRejectedValue(providerError(429));
    await expect(provider.embedQuery("q")).rejects.toMatchObject({
      code: "RATE_LIMITED",
      message: "Embedding provider rate limit reached.",
    });
    expect(mocks.countTokens).toHaveBeenCalledTimes(4);
  });

  it("rejects excessive batches and mismatched response counts", async () => {
    const provider = new GeminiEmbeddingProvider({ apiKey: "test-key", dimension: 128 });
    const inputs = Array.from({ length: 33 }, (_, index) => ({ id: String(index), text: "text" }));
    await expect(provider.embedDocuments(inputs)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.countTokens).not.toHaveBeenCalled();

    mocks.embedContent.mockResolvedValue({ embeddings: [] });
    await expect(provider.embedDocuments([{ id: "one", text: "text" }]))
      .rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});
