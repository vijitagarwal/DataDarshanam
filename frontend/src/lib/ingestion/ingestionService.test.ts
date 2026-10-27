import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processIngestionJob } from "./ingestionService";

const documentId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function makeClient(document: Record<string, unknown>, download: Blob | null = new Blob(["hello"])) {
  const updates: Array<Record<string, unknown>> = [];
  const maybeSingle = vi.fn().mockResolvedValue({ data: document, error: null });
  const eqUser = vi.fn().mockReturnValue({ maybeSingle });
  const eqDocument = vi.fn().mockReturnValue({ eq: eqUser });
  const select = vi.fn().mockReturnValue({ eq: eqDocument });
  const update = vi.fn().mockImplementation((values: Record<string, unknown>) => {
    updates.push(values);
    const chain = {
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({ error: null }),
    };
    chain.eq.mockReturnValue(chain);
    return chain;
  });
  return {
    client: {
      from: vi.fn().mockReturnValue({ select, update }),
      storage: { from: vi.fn().mockReturnValue({ download: vi.fn().mockResolvedValue({ data: download, error: null }) }) },
      rpc: vi.fn().mockResolvedValue({ error: null }),
    } as unknown as SupabaseClient,
    updates,
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("ingestion service", () => {
  it("persists extracted chunks through the privileged atomic RPC", async () => {
    const { client } = makeClient({
      id: documentId,
      user_id: userId,
      file_extension: "txt",
      storage_bucket: "documents",
      storage_path: `${userId}/${documentId}/original.txt`,
      status: "queued",
    });
    const result = await processIngestionJob(client, documentId, userId, {
      chunking: { chunkSize: 256, overlap: 0 },
    });
    expect(result).toMatchObject({ status: "ready", chunkCount: 1 });
    expect(client.rpc).toHaveBeenCalledWith("persist_document_extraction", expect.objectContaining({
      p_document_id: documentId,
      p_user_id: userId,
      p_extracted_text: "hello",
      p_chunks: expect.any(Array),
    }));
  });

  it("maps extraction failures to safe status fields without document content", async () => {
    const { client, updates } = makeClient({
      id: documentId,
      user_id: userId,
      file_extension: "pdf",
      storage_bucket: "documents",
      storage_path: `${userId}/${documentId}/original.pdf`,
      status: "queued",
    }, new Blob(["not a pdf"]));
    const result = await processIngestionJob(client, documentId, userId);
    expect(result).toMatchObject({ status: "failed", errorCode: "INVALID_SIGNATURE" });
    expect(updates).toContainEqual(expect.objectContaining({
      status: "failed",
      ingestion_error_code: "INVALID_SIGNATURE",
      ingestion_error_message: expect.not.stringContaining("not a pdf"),
    }));
  });

  it("does not process another user's document", async () => {
    const { client } = makeClient(null as unknown as Record<string, unknown>);
    const result = await processIngestionJob(client, documentId, userId);
    expect(result).toMatchObject({ status: "failed", errorCode: "NOT_FOUND" });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("is safe to retry ready jobs and rejects invalid states", async () => {
    const ready = makeClient({
      id: documentId, user_id: userId, file_extension: "txt",
      storage_bucket: "documents", storage_path: "ignored", status: "ready",
    });
    await expect(processIngestionJob(ready.client, documentId, userId))
      .resolves.toMatchObject({ status: "ready" });
    expect(ready.client.rpc).not.toHaveBeenCalled();

    const awaiting = makeClient({
      id: documentId, user_id: userId, file_extension: "txt",
      storage_bucket: "documents", storage_path: "ignored", status: "awaiting_upload",
    });
    await expect(processIngestionJob(awaiting.client, documentId, userId))
      .resolves.toMatchObject({ status: "failed", errorCode: "INVALID_STATUS" });
  });
});
