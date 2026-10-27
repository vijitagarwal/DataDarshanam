import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EmbeddingProviderError, classifyEmbeddingError } from "./errors";
import {
  formatDocumentEmbeddingContent,
  type GeminiEmbeddingProvider,
} from "./gemini";
import {
  DEFAULT_EMBEDDING_DIMENSION,
  DEFAULT_EMBEDDING_MODEL,
  getEmbeddingSpace,
  type EmbeddingDocumentInput,
  type EmbeddingIdentity,
} from "./provider";

const MAX_SOURCE_CHUNKS = 2_000;
const MAX_EMBEDDING_PARTS = 10_000;
const PREPARE_SOURCE_BATCH_SIZE = 32;
const PERSIST_BATCH_SIZE = 32;

interface EmbeddingDocument {
  id: string;
  user_id: string;
  display_name: string;
  status: string;
}

interface SourceChunk {
  id: string;
  document_id: string;
  user_id: string;
  chunk_index: number;
  text_content: string;
  content_hash: string;
  source_start: number;
  source_end: number;
  page_start: number | null;
  page_end: number | null;
  section_path: string[] | null;
}

interface EmbeddingManifestPart {
  source_chunk_id: string;
  part_index: number;
  source_content_hash: string;
  input_content_hash: string;
  input_text: string;
  provider_input_text: string;
  source_start: number;
  source_end: number;
  input: EmbeddingDocumentInput;
}

export type EmbeddingJobResult =
  | { status: "ready"; partCount: number; reusedCount: number }
  | { status: "processing"; partCount: number; reusedCount: number }
  | { status: "failed"; partCount: number; reusedCount: number; errorCode: string }
  | { status: "not_found"; partCount: 0; reusedCount: 0 }
  | { status: "invalid_status"; partCount: 0; reusedCount: 0 };

type EmbeddingCapableProvider = Pick<
  GeminiEmbeddingProvider,
  "getIdentity" | "prepareDocuments" | "embedDocuments"
>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeErrorCode(error: unknown): string {
  const classified = classifyEmbeddingError(error);
  if (classified.code !== "UNKNOWN_PROVIDER_ERROR") return classified.code;
  if (error instanceof EmbeddingProviderError) return error.code;
  return "PERSISTENCE_FAILED";
}

function makeManifestPart(
  input: EmbeddingDocumentInput,
  sourceHash: string,
): EmbeddingManifestPart {
  const providerInputText = formatDocumentEmbeddingContent(input);
  return {
    source_chunk_id: input.sourceChunkId ?? input.id,
    part_index: input.partIndex ?? 0,
    source_content_hash: sourceHash,
    input_content_hash: sha256(providerInputText),
    input_text: input.text,
    provider_input_text: providerInputText,
    source_start: input.sourceStart ?? 0,
    source_end: input.sourceEnd ?? input.text.length,
    input,
  };
}

function samePersistedPart(
  saved: Record<string, unknown>,
  expected: EmbeddingManifestPart,
  identity: EmbeddingIdentity,
  space: string,
): boolean {
  return saved.source_chunk_id === expected.source_chunk_id &&
    saved.part_index === expected.part_index &&
    saved.embedding_model === identity.model &&
    saved.embedding_dimension === identity.dimension &&
    saved.embedding_space === space &&
    saved.normalization_policy === identity.normalization &&
    saved.source_content_hash === expected.source_content_hash &&
    saved.input_content_hash === expected.input_content_hash &&
    saved.input_text === expected.input_text &&
    saved.provider_input_text === expected.provider_input_text &&
    saved.source_start === expected.source_start &&
    saved.source_end === expected.source_end;
}

function identityMatches(value: EmbeddingIdentity, expected: EmbeddingIdentity): boolean {
  return value.provider === expected.provider &&
    value.model === expected.model &&
    value.dimension === expected.dimension &&
    value.documentTask === expected.documentTask &&
    value.queryTask === expected.queryTask &&
    value.normalization === expected.normalization &&
    value.version === expected.version;
}

function isValidStoredVector(value: unknown, dimension: number): boolean {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return false;
    }
  }
  if (!Array.isArray(parsed) || parsed.length !== dimension ||
      !parsed.every(item => typeof item === "number" && Number.isFinite(item))) {
    return false;
  }
  const norm = Math.hypot(...parsed);
  return Number.isFinite(norm) && Math.abs(norm - 1) <= 1e-6;
}

function partKey(chunkId: string, partIndex: number): string {
  return `${chunkId}:${partIndex}`;
}

function manifestForRpc(part: EmbeddingManifestPart) {
  return {
    source_chunk_id: part.source_chunk_id,
    part_index: part.part_index,
    source_content_hash: part.source_content_hash,
    input_content_hash: part.input_content_hash,
    input_text: part.input_text,
    provider_input_text: part.provider_input_text,
    source_start: part.source_start,
    source_end: part.source_end,
  };
}

async function prepareManifest(
  provider: EmbeddingCapableProvider,
  chunks: SourceChunk[],
  document: EmbeddingDocument,
): Promise<EmbeddingManifestPart[]> {
  const manifest: EmbeddingManifestPart[] = [];
  for (let index = 0; index < chunks.length; index += PREPARE_SOURCE_BATCH_SIZE) {
    const batch = chunks.slice(index, index + PREPARE_SOURCE_BATCH_SIZE);
    const inputs = batch.map(chunk => ({
      id: chunk.id,
      sourceChunkId: chunk.id,
      partIndex: 0,
      documentId: document.id,
      ownerId: document.user_id,
      title: document.display_name,
      text: chunk.text_content,
      contentHash: chunk.content_hash,
      sourceContentHash: chunk.content_hash,
      sourceStart: chunk.source_start,
      sourceEnd: chunk.source_end,
      pageStart: chunk.page_start ?? undefined,
      pageEnd: chunk.page_end ?? undefined,
      sectionPath: chunk.section_path ?? undefined,
    }));
    const prepared = await provider.prepareDocuments(inputs);
    for (const part of prepared) {
      const source = batch.find(chunk => chunk.id === (part.input.sourceChunkId ?? part.input.id));
      if (!source || part.input.sourceStart === undefined || part.input.sourceEnd === undefined ||
          source.text_content.slice(
            part.input.sourceStart - source.source_start,
            part.input.sourceEnd - source.source_start,
          ) !== part.input.text) {
        throw new EmbeddingProviderError("INVALID_INPUT", "Prepared embedding offsets do not match the source chunk.");
      }
      manifest.push(makeManifestPart(part.input, source.content_hash));
      if (manifest.length > MAX_EMBEDDING_PARTS) {
        throw new EmbeddingProviderError("INPUT_TOO_LARGE", "The document requires too many embedding parts.");
      }
    }
  }
  return manifest;
}

export async function processDocumentEmbeddings(
  client: SupabaseClient,
  provider: EmbeddingCapableProvider,
  documentId: string,
  userId: string,
): Promise<EmbeddingJobResult> {
  const { data: rawDocument, error: documentError } = await client
    .from("documents")
    .select("id,user_id,display_name,status")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (documentError) {
    return { status: "failed", partCount: 0, reusedCount: 0, errorCode: "PERSISTENCE_FAILED" };
  }
  if (!rawDocument) return { status: "not_found", partCount: 0, reusedCount: 0 };
  const document = rawDocument as EmbeddingDocument;
  if (document.status !== "ready") return { status: "invalid_status", partCount: 0, reusedCount: 0 };

  const { data: rawChunks, error: chunksError } = await client
    .from("document_chunks")
    .select("id,document_id,user_id,chunk_index,text_content,content_hash,source_start,source_end,page_start,page_end,section_path")
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .order("chunk_index", { ascending: true })
    .limit(MAX_SOURCE_CHUNKS + 1);
  if (chunksError || !rawChunks || rawChunks.length === 0) {
    return {
      status: "failed",
      partCount: 0,
      reusedCount: 0,
      errorCode: "PERSISTENCE_FAILED",
    };
  }
  if (rawChunks.length > MAX_SOURCE_CHUNKS) {
    return { status: "failed", partCount: 0, reusedCount: 0, errorCode: "INPUT_TOO_LARGE" };
  }

  const chunks = rawChunks as SourceChunk[];
  const identity = provider.getIdentity();
  if (identity.model !== DEFAULT_EMBEDDING_MODEL || identity.dimension !== DEFAULT_EMBEDDING_DIMENSION) {
    return {
      status: "failed",
      partCount: 0,
      reusedCount: 0,
      errorCode: identity.dimension !== DEFAULT_EMBEDDING_DIMENSION
        ? "INVALID_DIMENSION"
        : "INVALID_INPUT",
    };
  }
  const space = getEmbeddingSpace(identity);
  let claimId: string | null = null;
  let partCount = 0;
  let reusedCount = 0;

  try {
    const manifest = await prepareManifest(provider, chunks, document);
    if (manifest.length === 0) throw new EmbeddingProviderError("INVALID_INPUT", "Document has no embedding inputs.");
    const manifestHash = sha256(JSON.stringify(manifest.map(part => ({
      source_chunk_id: part.source_chunk_id,
      part_index: part.part_index,
      source_content_hash: part.source_content_hash,
      input_content_hash: part.input_content_hash,
      input_text: part.input_text,
      provider_input_text: part.provider_input_text,
      source_start: part.source_start,
      source_end: part.source_end,
    }))));
    partCount = manifest.length;

    const { data: rawExisting, error: existingError } = await client
      .from("document_chunk_embeddings")
      .select("source_chunk_id,part_index,embedding_model,embedding_dimension,embedding_space,normalization_policy,source_content_hash,input_content_hash,input_text,provider_input_text,source_start,source_end,embedding")
      .eq("document_id", documentId)
      .eq("user_id", userId)
      .eq("embedding_space", space);
    if (existingError) throw new Error("embedding lookup failed");
    const existing = (rawExisting ?? []) as Array<Record<string, unknown>>;
    const existingByKey = new Map(existing.map(row => [
      partKey(String(row.source_chunk_id), Number(row.part_index)),
      row,
    ]));
    for (const part of manifest) {
      const saved = existingByKey.get(partKey(part.source_chunk_id, part.part_index));
      if (!saved) continue;
      if (!samePersistedPart(saved, part, identity, space) ||
          !isValidStoredVector(saved.embedding, identity.dimension)) {
        throw new EmbeddingProviderError("INVALID_INPUT", "A persisted embedding conflicts with the current input identity.");
      }
      reusedCount += 1;
    }

    const { data: rawClaim, error: claimError } = await client.rpc("claim_document_embedding_job", {
      p_document_id: documentId,
      p_user_id: userId,
      p_embedding_space: space,
      p_embedding_model: identity.model,
      p_embedding_dimension: identity.dimension,
      p_normalization_policy: identity.normalization,
      p_expected_part_count: manifest.length,
      p_manifest_hash: manifestHash,
      p_manifest: manifest.map(manifestForRpc),
    });
    if (claimError || !rawClaim) throw new Error("embedding job claim failed");
    const claim = Array.isArray(rawClaim) ? rawClaim[0] : rawClaim;
    if (claim.job_status === "ready") {
      return { status: "ready", partCount, reusedCount: manifest.length };
    }
    if (claim.job_status === "processing" || !claim.job_claim_id) {
      return { status: "processing", partCount, reusedCount };
    }
    claimId = String(claim.job_claim_id);

    const missing = manifest.filter(part =>
      !existingByKey.has(partKey(part.source_chunk_id, part.part_index)));
    for (let index = 0; index < missing.length; index += PERSIST_BATCH_SIZE) {
      const batch = missing.slice(index, index + PERSIST_BATCH_SIZE);
      const embedded = await provider.embedDocuments(batch.map(part => part.input));
      if (embedded.length !== batch.length) {
        throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider returned an unexpected result count.");
      }
      const byId = new Map(embedded.map(result => [result.inputId, result]));
      const records = batch.map(part => {
        const result = byId.get(part.input.id);
        if (!result || !identityMatches(result.identity, identity) ||
            result.sourceChunkId !== part.source_chunk_id ||
            result.partIndex !== part.part_index ||
            result.sourceStart !== part.source_start || result.sourceEnd !== part.source_end ||
            result.values.length !== identity.dimension ||
            !result.values.every(Number.isFinite)) {
          throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider result did not match its input.");
        }
        const norm = Math.hypot(...result.values);
        if (!Number.isFinite(norm) || Math.abs(norm - 1) > 1e-6) {
          throw new EmbeddingProviderError("INVALID_PROVIDER_RESPONSE", "Embedding provider returned a non-normalized vector.");
        }
        return {
          source_chunk_id: part.source_chunk_id,
          part_index: part.part_index,
          embedding_model: identity.model,
          embedding_dimension: identity.dimension,
          embedding_space: space,
          normalization_policy: identity.normalization,
          source_content_hash: part.source_content_hash,
          input_content_hash: part.input_content_hash,
          input_text: part.input_text,
          provider_input_text: part.provider_input_text,
          source_start: part.source_start,
          source_end: part.source_end,
          embedding: result.values,
        };
      });
      const { error: persistError } = await client.rpc("persist_document_embedding_batch", {
        p_document_id: documentId,
        p_user_id: userId,
        p_embedding_space: space,
        p_claim_id: claimId,
        p_embeddings: records,
      });
      if (persistError) throw new Error("embedding persistence failed");
    }

    const { data: finished, error: finishError } = await client.rpc("finish_document_embedding_job", {
      p_document_id: documentId,
      p_user_id: userId,
      p_embedding_space: space,
      p_claim_id: claimId,
    });
    if (finishError || finished !== true) throw new Error("embedding job completion failed");
    return { status: "ready", partCount, reusedCount };
  } catch (error) {
    const errorCode = safeErrorCode(error);
    if (claimId) {
      const { data: failed, error: failError } = await client.rpc("fail_document_embedding_job", {
        p_document_id: documentId,
        p_user_id: userId,
        p_embedding_space: space,
        p_claim_id: claimId,
        p_error_code: errorCode,
      });
      if (failError || failed !== true) {
        return { status: "processing", partCount, reusedCount };
      }
    }
    return { status: "failed", partCount, reusedCount, errorCode };
  }
}
