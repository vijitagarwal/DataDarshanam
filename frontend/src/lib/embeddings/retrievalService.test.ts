import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { EmbeddingIdentity, EmbeddingResult } from "./provider";
import { DEFAULT_EMBEDDING_DIMENSION, DEFAULT_EMBEDDING_MODEL } from "./provider";
import { RetrievalError, retrieveDocumentChunks } from "./retrievalService";

const identity: EmbeddingIdentity = {
  provider: "google-gemini",
  model: DEFAULT_EMBEDDING_MODEL,
  dimension: DEFAULT_EMBEDDING_DIMENSION,
  documentTask: "RETRIEVAL_DOCUMENT",
  queryTask: "RETRIEVAL_QUERY",
  normalization: "l2-unit-v1",
  version: "google-gemini/gemini-embedding-001/retrieval-v1/dim-768/norm-l2-v1",
};
const queryVector = [1, ...Array.from({ length: 767 }, () => 0)];
const rows = [
  {
    document_id: "11111111-1111-4111-8111-111111111111",
    document_name: "Policies",
    chunk_id: "33333333-3333-4333-8333-333333333333",
    chunk_index: 2,
    text_content: "Relevant canonical source text",
    source_start: 120,
    source_end: 151,
    page_start: 4,
    page_end: 4,
    section_path: ["Main", "Coverage"],
    similarity: 0.9,
  },
  {
    document_id: "11111111-1111-4111-8111-111111111111",
    document_name: "Policies",
    chunk_id: "44444444-4444-4444-8444-444444444444",
    chunk_index: 3,
    text_content: "Second ranked source",
    source_start: 151,
    source_end: 172,
    page_start: null,
    page_end: null,
    section_path: null,
    similarity: 0.7,
  },
];

function makeProvider(
  providerIdentity = identity,
  resultIdentity = providerIdentity,
  vector: number[] = queryVector,
) {
  return {
    getIdentity: vi.fn(() => providerIdentity),
    embedQuery: vi.fn(async (): Promise<EmbeddingResult> => ({
      values: vector,
      inputId: "query",
      identity: resultIdentity,
    })),
  };
}

function makeClient(data: unknown = rows, error: unknown = null) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    void name;
    void args;
    return { data, error };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("secure document retrieval service", () => {
  it("uses the exact embedding space, bounded scope and limit and preserves rank/source metadata", async () => {
    const { client, rpc } = makeClient();
    const provider = makeProvider();
    const documentIds = ["11111111-1111-4111-8111-111111111111"];

    const result = await retrieveDocumentChunks(client, provider, "  coverage details  ", documentIds, 2);

    expect(result.map(item => item.similarity)).toEqual([0.9, 0.7]);
    expect(result[0]).toMatchObject({
      documentId: rows[0].document_id,
      documentName: "Policies",
      chunkId: rows[0].chunk_id,
      text: rows[0].text_content,
      sourceStart: 120,
      sourceEnd: 151,
      pageStart: 4,
      sectionPath: ["Main", "Coverage"],
    });
    expect(rpc).toHaveBeenCalledWith("retrieve_document_chunks", expect.objectContaining({
      p_embedding_model: identity.model,
      p_embedding_dimension: 768,
      p_normalization_policy: "l2-unit-v1",
      p_document_ids: documentIds,
      p_result_limit: 2,
      p_query_embedding: expect.stringMatching(/^\[1,0,/),
    }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_user_id");
    expect(provider.embedQuery).toHaveBeenCalledWith("coverage details");
  });

  it("returns an empty result without inventing a similarity threshold", async () => {
    const { client, rpc } = makeClient([]);
    await expect(retrieveDocumentChunks(client, makeProvider(), "query"))
      .resolves.toEqual([]);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it.each(["", "  ", "x".repeat(5_001)])("rejects empty or oversized query %s", async query => {
    const { client, rpc } = makeClient();
    const provider = makeProvider();
    await expect(retrieveDocumentChunks(client, provider, query)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(provider.embedQuery).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid limits and document scopes before provider use", async () => {
    const { client, rpc } = makeClient();
    const provider = makeProvider();
    await expect(retrieveDocumentChunks(client, provider, "query", undefined, 21))
      .rejects.toBeInstanceOf(RetrievalError);
    await expect(retrieveDocumentChunks(client, provider, "query", ["not-a-uuid"]))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(provider.embedQuery).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a provider configuration outside the persisted embedding space", async () => {
    const { client, rpc } = makeClient();
    const provider = makeProvider({ ...identity, dimension: 384 });
    await expect(retrieveDocumentChunks(client, provider, "query"))
      .rejects.toMatchObject({ code: "INCOMPATIBLE_EMBEDDINGS" });
    expect(provider.embedQuery).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects query vector identity mismatches and invalid vectors", async () => {
    const { client, rpc } = makeClient();
    await expect(retrieveDocumentChunks(
      client,
      makeProvider(identity, { ...identity, version: "different-space" }),
      "query",
    )).rejects.toMatchObject({ code: "INCOMPATIBLE_EMBEDDINGS" });
    await expect(retrieveDocumentChunks(client, makeProvider(identity, identity, []), "query"))
      .rejects.toMatchObject({ code: "INCOMPATIBLE_EMBEDDINGS" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sanitizes provider and database failures", async () => {
    const { client: databaseClient, rpc } = makeClient(null, { message: "private SQL details" });
    const failingProvider = makeProvider();
    failingProvider.embedQuery.mockRejectedValue(new Error("provider token secret"));
    await expect(retrieveDocumentChunks(databaseClient, failingProvider, "query"))
      .rejects.toMatchObject({ code: "PROVIDER_FAILED" });

    await expect(retrieveDocumentChunks(databaseClient, makeProvider(), "query"))
      .rejects.toMatchObject({ code: "DATABASE_FAILED" });
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("rejects malformed database results without returning them", async () => {
    const { client } = makeClient([{ ...rows[0], similarity: Number.NaN }]);
    await expect(retrieveDocumentChunks(client, makeProvider(), "query"))
      .rejects.toMatchObject({ code: "DATABASE_FAILED" });
  });
});
