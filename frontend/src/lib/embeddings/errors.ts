export type EmbeddingErrorCode =
  | "NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "TRANSIENT_PROVIDER_FAILURE"
  | "TIMEOUT"
  | "INVALID_DIMENSION"
  | "INVALID_PROVIDER_RESPONSE"
  | "TOKEN_COUNT_FAILED"
  | "INPUT_TOO_LARGE"
  | "AGGREGATE_TOKEN_BUDGET_EXCEEDED"
  | "UNKNOWN_PROVIDER_ERROR";

export class EmbeddingProviderError extends Error {
  constructor(
    public readonly code: EmbeddingErrorCode,
    message: string,
    options?: { retryAfterMs?: number },
  ) {
    super(message);
    this.name = "EmbeddingProviderError";
    this.retryAfterMs = options?.retryAfterMs;
  }

  readonly retryAfterMs?: number;
}

export function classifyEmbeddingError(error: unknown): EmbeddingProviderError {
  if (error instanceof EmbeddingProviderError) return error;
  const errorObject = typeof error === "object" && error !== null
    ? error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown }
    : undefined;
  const status = Number(errorObject?.status);
  const code = typeof errorObject?.code === "string" ? errorObject.code.toUpperCase() : "";
  const name = typeof errorObject?.name === "string" ? errorObject.name : "";
  const message = typeof errorObject?.message === "string" ? errorObject.message.toUpperCase() : "";
  if (code.includes("QUOTA_EXCEEDED") || code.includes("RESOURCE_EXHAUSTED") ||
      message.includes("QUOTA") || message.includes("RESOURCE_EXHAUSTED")) {
    return new EmbeddingProviderError("QUOTA_EXCEEDED", "Embedding provider quota is exhausted.");
  }
  if (status === 401 || status === 403) {
    return new EmbeddingProviderError("AUTHENTICATION_FAILED", "Embedding provider authentication failed.");
  }
  if (status === 429) {
    return new EmbeddingProviderError("RATE_LIMITED", "Embedding provider rate limit reached.");
  }
  if (status === 408 || name === "TimeoutError" || code === "ETIMEDOUT") {
    return new EmbeddingProviderError("TIMEOUT", "Embedding provider request timed out.");
  }
  if (status !== undefined && status >= 500) {
    return new EmbeddingProviderError("TRANSIENT_PROVIDER_FAILURE", "Embedding provider is temporarily unavailable.");
  }
  if (error instanceof TypeError) {
    return new EmbeddingProviderError("TRANSIENT_PROVIDER_FAILURE", "Embedding provider is temporarily unavailable.");
  }
  return new EmbeddingProviderError("UNKNOWN_PROVIDER_ERROR", "Embedding provider request failed.");
}
