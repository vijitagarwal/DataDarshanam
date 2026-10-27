import { describe, expect, it } from "vitest";
import { EmbeddingProviderError } from "./errors";
import {
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  isRetryableEmbeddingError,
  normalizeEmbeddingValues,
  validateEmbeddingValues,
} from "./provider";

describe("embedding provider contract", () => {
  it("uses the verified stable model and candidate dimension", () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe("gemini-embedding-001");
    expect(DEFAULT_EMBEDDING_DIMENSION).toBe(768);
  });

  it("accepts finite non-zero vectors of the configured dimension", () => {
    expect(validateEmbeddingValues([0.1, -0.2], 2)).toEqual([0.1, -0.2]);
    expect(() => validateEmbeddingValues([0.1], 2)).toThrow();
    expect(() => validateEmbeddingValues([Number.NaN, 0.1], 2)).toThrow();
    expect(() => validateEmbeddingValues([0, 0], 2)).toThrow();
  });

  it("normalizes document and query vectors using the versioned L2 policy", () => {
    const normalized = normalizeEmbeddingValues([3, 4], 2);
    expect(normalized).toEqual([0.6, 0.8]);
    expect(Math.hypot(...normalized)).toBeCloseTo(1, 12);
    expect(() => normalizeEmbeddingValues([0, 0], 2)).toThrow();
    expect(() => normalizeEmbeddingValues([Number.POSITIVE_INFINITY, 1], 2)).toThrow();
  });

  it("classifies retryable error codes without exposing provider details", () => {
    expect(isRetryableEmbeddingError("RATE_LIMITED")).toBe(true);
    expect(isRetryableEmbeddingError("AUTHENTICATION_FAILED")).toBe(false);
    expect(isRetryableEmbeddingError("QUOTA_EXCEEDED")).toBe(false);
    const error = new EmbeddingProviderError("QUOTA_EXCEEDED", "Embedding quota reached.");
    expect(error.code).toBe("QUOTA_EXCEEDED");
    expect(error.message).not.toContain("key");
  });
});
