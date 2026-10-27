import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingSpace,
  normalizeEmbeddingValues,
  type EmbeddingIdentity,
  type EmbeddingProvider,
} from "./provider";
import { EmbeddingProviderError, classifyEmbeddingError } from "./errors";

export const DEFAULT_RETRIEVAL_LIMIT = 5;
export const MAX_RETRIEVAL_LIMIT = 20;
export const MAX_RETRIEVAL_DOCUMENT_IDS = 50;
export const MAX_RETRIEVAL_QUERY_LENGTH = 5_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RetrievedChunk {
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  text: string;
  sourceStart: number;
  sourceEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: string[] | null;
  similarity: number;
}

export type RetrievalErrorCode =
  | "INVALID_INPUT"
  | "INCOMPATIBLE_EMBEDDINGS"
  | "PROVIDER_FAILED"
  | "DATABASE_FAILED";

export class RetrievalError extends Error {
  constructor(
    public readonly code: RetrievalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RetrievalError";
  }
}

type QueryEmbeddingProvider = Pick<EmbeddingProvider, "getIdentity" | "embedQuery">;

function isSupportedIdentity(identity: unknown): identity is EmbeddingIdentity {
  if (typeof identity !== "object" || identity === null) return false;
  const value = identity as Record<string, unknown>;
  if (value.provider !== "google-gemini" ||
      value.model !== DEFAULT_EMBEDDING_MODEL ||
      value.dimension !== DEFAULT_EMBEDDING_DIMENSION ||
      value.documentTask !== "RETRIEVAL_DOCUMENT" ||
      value.queryTask !== "RETRIEVAL_QUERY" ||
      value.normalization !== "l2-unit-v1" ||
      typeof value.version !== "string" ||
      !value.version.trim()) {
    return false;
  }
  return getEmbeddingSpace({
    provider: "google-gemini",
    model: DEFAULT_EMBEDDING_MODEL,
    dimension: DEFAULT_EMBEDDING_DIMENSION,
    documentTask: "RETRIEVAL_DOCUMENT",
    queryTask: "RETRIEVAL_QUERY",
    normalization: "l2-unit-v1",
    version: value.version,
  }).length <= 200;
}

function sameIdentity(left: EmbeddingIdentity, right: EmbeddingIdentity): boolean {
  return left.provider === right.provider &&
    left.model === right.model &&
    left.dimension === right.dimension &&
    left.documentTask === right.documentTask &&
    left.queryTask === right.queryTask &&
    left.normalization === right.normalization &&
    left.version === right.version;
}

function validateInput(
  query: string,
  documentIds: readonly string[] | undefined,
  limit: number,
): string {
  const normalizedQuery = query.trim();
  if (!normalizedQuery || normalizedQuery.length > MAX_RETRIEVAL_QUERY_LENGTH) {
    throw new RetrievalError("INVALID_INPUT", "Query must contain 1 to 5,000 characters.");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RETRIEVAL_LIMIT) {
    throw new RetrievalError("INVALID_INPUT", `Result limit must be between 1 and ${MAX_RETRIEVAL_LIMIT}.`);
  }
  if (documentIds !== undefined &&
      (documentIds.length > MAX_RETRIEVAL_DOCUMENT_IDS ||
       documentIds.some(id => !UUID_PATTERN.test(id)))) {
    throw new RetrievalError("INVALID_INPUT", "Document scope contains an invalid document ID.");
  }
  return normalizedQuery;
}

function mapRetrievedRows(value: unknown): RetrievedChunk[] {
  if (!Array.isArray(value)) throw new RetrievalError("DATABASE_FAILED", "Retrieval returned an invalid result.");
  return value.map((row: unknown) => {
    if (typeof row !== "object" || row === null) {
      throw new RetrievalError("DATABASE_FAILED", "Retrieval returned an invalid result.");
    }
    const item = row as Record<string, unknown>;
    if (typeof item.document_id !== "string" ||
        !UUID_PATTERN.test(item.document_id) ||
        typeof item.document_name !== "string" ||
        typeof item.chunk_id !== "string" ||
        !UUID_PATTERN.test(item.chunk_id) ||
        !Number.isInteger(item.chunk_index) ||
        (item.chunk_index as number) < 0 ||
        typeof item.text_content !== "string" ||
        !Number.isInteger(item.source_start) ||
        (item.source_start as number) < 0 ||
        !Number.isInteger(item.source_end) ||
        (item.source_end as number) <= (item.source_start as number) ||
        (item.page_start !== null && !Number.isInteger(item.page_start)) ||
        (item.page_end !== null && !Number.isInteger(item.page_end)) ||
        (typeof item.page_start === "number" && item.page_start < 1) ||
        (typeof item.page_end === "number" &&
          (item.page_end < 1 ||
           (typeof item.page_start === "number" && item.page_end < item.page_start))) ||
        (item.section_path !== null &&
          (!Array.isArray(item.section_path) || !item.section_path.every(value => typeof value === "string"))) ||
        typeof item.similarity !== "number" ||
        !Number.isFinite(item.similarity) ||
        item.similarity < -1.00001 ||
        item.similarity > 1.00001) {
      throw new RetrievalError("DATABASE_FAILED", "Retrieval returned an invalid result.");
    }
    return {
      documentId: item.document_id,
      documentName: item.document_name,
      chunkId: item.chunk_id,
      chunkIndex: item.chunk_index as number,
      text: item.text_content,
      sourceStart: item.source_start as number,
      sourceEnd: item.source_end as number,
      pageStart: item.page_start as number | null,
      pageEnd: item.page_end as number | null,
      sectionPath: item.section_path as string[] | null,
      similarity: item.similarity,
    };
  });
}

export async function retrieveDocumentChunks(
  client: SupabaseClient,
  provider: QueryEmbeddingProvider,
  query: string,
  documentIds: readonly string[] | undefined = undefined,
  limit = DEFAULT_RETRIEVAL_LIMIT,
): Promise<RetrievedChunk[]> {
  const normalizedQuery = validateInput(query, documentIds, limit);
  const identity = provider.getIdentity();
  if (!isSupportedIdentity(identity)) {
    throw new RetrievalError("INCOMPATIBLE_EMBEDDINGS", "Embedding configuration is incompatible with persisted documents.");
  }

  let queryResult;
  try {
    queryResult = await provider.embedQuery(normalizedQuery);
  } catch (error) {
    const classified = classifyEmbeddingError(error);
    throw new RetrievalError(
      "PROVIDER_FAILED",
      classified.code === "NOT_CONFIGURED"
        ? "Embedding provider is not configured."
        : "Query embedding could not be created.",
    );
  }
  if (!isSupportedIdentity(queryResult.identity) || !sameIdentity(queryResult.identity, identity)) {
    throw new RetrievalError("INCOMPATIBLE_EMBEDDINGS", "Query embedding configuration does not match persisted documents.");
  }

  let vector: number[];
  try {
    vector = normalizeEmbeddingValues(queryResult.values, DEFAULT_EMBEDDING_DIMENSION);
  } catch (error) {
    if (error instanceof EmbeddingProviderError) {
      throw new RetrievalError("INCOMPATIBLE_EMBEDDINGS", "Query embedding is invalid for the persisted vector space.");
    }
    throw error;
  }

  const { data, error } = await client.rpc("retrieve_document_chunks", {
    p_embedding_space: getEmbeddingSpace(identity),
    p_embedding_model: identity.model,
    p_embedding_dimension: identity.dimension,
    p_normalization_policy: identity.normalization,
    p_query_embedding: `[${vector.join(",")}]`,
    p_document_ids: documentIds ?? null,
    p_result_limit: limit,
  });
  if (error) throw new RetrievalError("DATABASE_FAILED", "Document retrieval is temporarily unavailable.");
  return mapRetrievedRows(data);
}
