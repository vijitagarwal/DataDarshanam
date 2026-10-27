import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkDocument, type ChunkingOptions, DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from "./chunker";
import { buildCanonicalText, extractDocument, ExtractionError } from "./extraction";

const SAFE_FAILURES: Record<string, string> = {
  EMPTY_DOCUMENT: "The document contains no extractable text.",
  EXTRACTION_LIMIT: "The document exceeds safe processing limits.",
  EXTRACTION_TIMEOUT: "Document processing timed out.",
  ENCRYPTED_DOCUMENT: "Password-protected documents are not supported.",
  INVALID_SIGNATURE: "The uploaded file content does not match its format.",
  MALFORMED_DOCUMENT: "The document could not be safely parsed.",
  UNSUPPORTED_FORMAT: "This document format is not supported.",
};

interface IngestionDocument {
  id: string;
  user_id: string;
  file_extension: "pdf" | "docx" | "txt" | "md" | "markdown";
  storage_bucket: string;
  storage_path: string;
  status: string;
}

interface IngestionClient extends SupabaseClient {
  storage: SupabaseClient["storage"];
}

export interface IngestionResult {
  status: "ready" | "failed";
  chunkCount: number;
  errorCode?: string;
}

export interface IngestionOptions {
  chunking?: ChunkingOptions;
}

function publicFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ExtractionError) {
    return { code: error.code, message: SAFE_FAILURES[error.code] ?? "Document processing failed." };
  }
  return { code: "INGESTION_FAILED", message: "Document processing failed. Please retry." };
}

export async function processIngestionJob(
  client: IngestionClient,
  documentId: string,
  userId: string,
  options: IngestionOptions = {},
): Promise<IngestionResult> {
  const { data: document, error: documentError } = await client
    .from("documents")
    .select("id,user_id,file_extension,storage_bucket,storage_path,status")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (documentError || !document) {
    return { status: "failed", chunkCount: 0, errorCode: "NOT_FOUND" };
  }
  const ownedDocument = document as IngestionDocument;
  if (ownedDocument.status === "ready") return { status: "ready", chunkCount: 0 };
  if (ownedDocument.status !== "queued" && ownedDocument.status !== "processing") {
    return { status: "failed", chunkCount: 0, errorCode: "INVALID_STATUS" };
  }

  try {
    await client.from("documents").update({ status: "processing" }).eq("id", documentId).eq("user_id", userId);
    await client.from("ingestion_jobs").update({
      status: "processing",
      started_at: new Date().toISOString(),
    }).eq("document_id", documentId).eq("user_id", userId).in("status", ["queued", "processing"]);
    const { data: object, error: downloadError } = await client.storage
      .from(ownedDocument.storage_bucket)
      .download(ownedDocument.storage_path);
    if (downloadError || !object) throw new Error("storage download failed");
    const bytes = new Uint8Array(await object.arrayBuffer());
    const extracted = await extractDocument(bytes, ownedDocument.file_extension);
    const chunks = chunkDocument(extracted, options.chunking ?? {
      chunkSize: DEFAULT_CHUNK_SIZE,
      overlap: DEFAULT_CHUNK_OVERLAP,
    });
    if (chunks.length === 0) throw new ExtractionError("EMPTY_DOCUMENT", "The document contains no extractable text.");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const canonicalText = buildCanonicalText(extracted);
    const { error: persistError } = await client.rpc("persist_document_extraction", {
      p_document_id: documentId,
      p_user_id: userId,
      p_content_hash: contentHash,
      p_extracted_text: canonicalText,
      p_character_count: extracted.characterCount,
      p_page_count: extracted.pageCount ?? null,
      p_extraction_version: "mission6-v1",
      p_chunking_version: `chars-${(options.chunking ?? { chunkSize: DEFAULT_CHUNK_SIZE, overlap: DEFAULT_CHUNK_OVERLAP }).chunkSize}-overlap-${(options.chunking ?? { chunkSize: DEFAULT_CHUNK_SIZE, overlap: DEFAULT_CHUNK_OVERLAP }).overlap}`,
      p_chunks: chunks,
    });
    if (persistError) throw persistError;
    return { status: "ready", chunkCount: chunks.length };
  } catch (error) {
    const failure = publicFailure(error);
    await client.from("documents").update({
      status: "failed",
      ingestion_error_code: failure.code,
      ingestion_error_message: failure.message,
    }).eq("id", documentId).eq("user_id", userId);
    await client.from("ingestion_jobs").update({
      status: "failed",
      error_code: failure.code,
      error_message: failure.message,
      finished_at: new Date().toISOString(),
    }).eq("document_id", documentId).eq("user_id", userId).in("status", ["queued", "processing"]);
    return { status: "failed", chunkCount: 0, errorCode: failure.code };
  }
}
