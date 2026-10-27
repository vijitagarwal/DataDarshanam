import { EmbeddingProviderError, type EmbeddingErrorCode } from "./errors";

export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
export const DEFAULT_EMBEDDING_DIMENSION = 768;
export const DEFAULT_EMBEDDING_VERSION = "google-gemini/gemini-embedding-001/retrieval-v1/dim-768/norm-l2-v1";
export const DEFAULT_MAX_INPUT_TOKENS = 2_048;
export const DEFAULT_MAX_REQUEST_TOKENS = 16_384;
export const MAX_EMBEDDING_INPUTS = 32;

export interface EmbeddingIdentity {
  provider: "google-gemini";
  model: string;
  dimension: number;
  documentTask: "RETRIEVAL_DOCUMENT";
  queryTask: "RETRIEVAL_QUERY";
  normalization: "l2-unit-v1";
  version: string;
}

export interface EmbeddingDocumentInput {
  id: string;
  text: string;
  title?: string;
  contentHash?: string;
  sourceContentHash?: string;
  sourceChunkId?: string;
  partIndex?: number;
  documentId?: string;
  ownerId?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionPath?: string[];
  sourceStart?: number;
  sourceEnd?: number;
}

export interface EmbeddingResult {
  values: number[];
  inputId?: string;
  contentHash?: string;
  sourceContentHash?: string;
  sourceChunkId?: string;
  partIndex?: number;
  documentId?: string;
  ownerId?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionPath?: string[];
  sourceStart?: number;
  sourceEnd?: number;
  identity: EmbeddingIdentity;
}

export interface EmbeddingProvider {
  embedDocuments(inputs: readonly EmbeddingDocumentInput[]): Promise<EmbeddingResult[]>;
  embedQuery(input: string): Promise<EmbeddingResult>;
  getIdentity(): EmbeddingIdentity;
}

export interface EmbeddingProviderConfig {
  apiKey: string;
  model?: string;
  dimension?: number;
  version?: string;
  maxInputTokens?: number;
  maxRequestTokens?: number;
  maxRetries?: number;
}

export function getEmbeddingConfig(): Omit<EmbeddingProviderConfig, "apiKey"> & { apiKey?: string } {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const dimension = Number(process.env.GEMINI_EMBEDDING_DIMENSION ?? DEFAULT_EMBEDDING_DIMENSION);
  const maxInputTokens = Number(process.env.GEMINI_EMBEDDING_MAX_INPUT_TOKENS ?? DEFAULT_MAX_INPUT_TOKENS);
  const maxRequestTokens = Number(process.env.GEMINI_EMBEDDING_MAX_REQUEST_TOKENS ?? DEFAULT_MAX_REQUEST_TOKENS);
  const version = process.env.GEMINI_EMBEDDING_VERSION ?? (
    `google-gemini/${model}/retrieval-v1/dim-${dimension}/norm-l2-v1`
  );
  return { apiKey, model, dimension, version, maxInputTokens, maxRequestTokens };
}

export function getEmbeddingSpace(identity: EmbeddingIdentity): string {
  return [
    identity.provider,
    identity.model,
    `dim-${identity.dimension}`,
    identity.documentTask,
    identity.queryTask,
    identity.normalization,
    identity.version,
  ].join("/");
}

export function validateEmbeddingValues(
  values: unknown,
  dimension: number,
): number[] {
  if (!Array.isArray(values) || values.length !== dimension ||
      !values.every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider returned an invalid vector.");
  }
  if (values.every(value => value === 0)) {
    throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider returned a zero vector.");
  }
  return values;
}

export function normalizeEmbeddingValues(values: unknown, dimension: number): number[] {
  const validated = validateEmbeddingValues(values, dimension);
  const norm = Math.hypot(...validated);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider returned an invalid vector norm.");
  }
  const normalized = validated.map(value => value / norm);
  if (!normalized.every(Number.isFinite) || Math.abs(Math.hypot(...normalized) - 1) > 1e-6) {
    throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding vector normalization failed.");
  }
  return normalized;
}

export function isRetryableEmbeddingError(code: EmbeddingErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "TRANSIENT_PROVIDER_FAILURE" || code === "TIMEOUT";
}
