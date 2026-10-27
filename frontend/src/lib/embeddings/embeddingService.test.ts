import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiEmbeddingProvider } from "./gemini";
import { processDocumentEmbeddings } from "./embeddingService";
import type { EmbeddingDocumentInput, EmbeddingIdentity, EmbeddingResult } from "./provider";

const documentId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const identity: EmbeddingIdentity = {
  provider: "google-gemini",
  model: "gemini-embedding-001",
  dimension: 768,
  documentTask: "RETRIEVAL_DOCUMENT",
  queryTask: "RETRIEVAL_QUERY",
  normalization: "l2-unit-v1",
  version: "google-gemini/gemini-embedding-001/retrieval-v1/dim-768/norm-l2-v1",
};
const vector = [1, ...Array.from({ length: 767 }, () => 0)];

interface FakeState {
  chunks: Array<Record<string, unknown>>;
  saved: Array<Record<string, unknown>>;
  documentLookupFails: boolean;
  ready: boolean;
  failed: boolean;
  failPersistOnCall: number | null;
  activeProcessing: boolean;
  failStatusUpdate: boolean;
  embedCalls: string[][];
  rpcCalls: string[];
}

function createClient(state: FakeState, visibleUser = userId): SupabaseClient {
  const makeQuery = (table: string) => {
    let userFilter = "";
    let docFilter = "";
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => {
        if (column === "user_id") userFilter = value;
        if (column === "document_id" || column === "id") docFilter = value;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({
        data: table === "documents" && userFilter === visibleUser
          ? { id: documentId, user_id: userId, display_name: "Policies", status: "ready" }
          : null,
        error: table === "documents" && state.documentLookupFails ? { message: "private database details" } : null,
      }),
      then: (resolve: (value: { data: unknown; error: null }) => unknown) => {
        let data: unknown = null;
        if (table === "document_chunks" && docFilter === documentId && userFilter === userId) data = state.chunks;
        if (table === "document_chunk_embeddings" && docFilter === documentId && userFilter === userId) data = state.saved;
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return builder;
  };

  return {
    from: (table: string) => makeQuery(table),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(name);
      if (name === "claim_document_embedding_job") {
        return {
          data: [{
            job_status: state.ready ? "ready" : state.activeProcessing ? "processing" : "claimed",
            job_claim_id: state.ready || state.activeProcessing ? null : "claim-1",
          }],
          error: null,
        };
      }
      if (name === "persist_document_embedding_batch") {
        const persistCall = state.rpcCalls.filter(call => call === "persist_document_embedding_batch").length;
        if (state.failPersistOnCall === persistCall) {
          state.failPersistOnCall = null;
          return { data: null, error: { message: "private database details" } };
        }
        const records = args.p_embeddings as Array<Record<string, unknown>>;
        for (const record of records) {
          state.saved.push({
            ...record,
            document_id: documentId,
            user_id: userId,
          });
        }
        return { data: records.length, error: null };
      }
      if (name === "finish_document_embedding_job") {
        state.ready = true;
        return { data: true, error: null };
      }
      if (name === "fail_document_embedding_job") {
        state.failed = true;
        if (state.failStatusUpdate) {
          return { data: null, error: { message: "private database details" } };
        }
        return { data: true, error: null };
      }
      return { data: null, error: { message: "unexpected RPC" } };
    },
  } as unknown as SupabaseClient;
}

function createChunks(count: number): FakeState["chunks"] {
  return Array.from({ length: count }, (_, index) => {
    const text = `chunk-${index}`;
    return {
      id: `chunk-id-${index}`,
      document_id: documentId,
      user_id: userId,
      chunk_index: index,
      text_content: text,
      content_hash: `${String(index).padStart(64, "0")}`,
      source_start: index * 10,
      source_end: index * 10 + text.length,
      page_start: null,
      page_end: null,
      section_path: ["Root"],
    };
  });
}

function makeProvider() {
  const embedCalls: string[][] = [];
  const provider = {
    getIdentity: vi.fn(() => identity),
    prepareDocuments: vi.fn(async (inputs: readonly EmbeddingDocumentInput[]) => inputs.map(input => ({
      input: { ...input },
      tokenCount: input.text.length,
    }))),
    embedDocuments: vi.fn(async (inputs: readonly EmbeddingDocumentInput[]): Promise<EmbeddingResult[]> => {
      embedCalls.push(inputs.map(input => input.id));
      return inputs.map(input => ({
        values: vector,
        inputId: input.id,
        sourceChunkId: input.sourceChunkId,
        partIndex: input.partIndex,
        documentId: input.documentId,
        ownerId: input.ownerId,
        sourceStart: input.sourceStart,
        sourceEnd: input.sourceEnd,
        identity,
      }));
    }),
  };
  return { provider: provider as unknown as GeminiEmbeddingProvider, embedCalls };
}

function stateWith(chunks = createChunks(1)): FakeState {
  return {
    chunks,
    saved: [],
    documentLookupFails: false,
    ready: false,
    failed: false,
    failPersistOnCall: null,
    activeProcessing: false,
    failStatusUpdate: false,
    embedCalls: [],
    rpcCalls: [],
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("document embedding persistence", () => {
  it("reports document lookup failures as retryable persistence errors, not missing documents", async () => {
    const state = stateWith();
    state.documentLookupFails = true;
    const { provider } = makeProvider();

    const result = await processDocumentEmbeddings(createClient(state), provider, documentId, userId);

    expect(result).toEqual({ status: "failed", partCount: 0, reusedCount: 0, errorCode: "PERSISTENCE_FAILED" });
    expect(provider.prepareDocuments).not.toHaveBeenCalled();
  });

  it("persists exact derived inputs with owner, chunk, source offsets, and normalization identity", async () => {
    const state = stateWith();
    const { provider } = makeProvider();
    const result = await processDocumentEmbeddings(createClient(state), provider, documentId, userId);

    expect(result).toMatchObject({ status: "ready", partCount: 1, reusedCount: 0 });
    expect(state.saved).toHaveLength(1);
    expect(state.saved[0]).toMatchObject({
      document_id: documentId,
      user_id: userId,
      source_chunk_id: "chunk-id-0",
      part_index: 0,
      embedding_model: identity.model,
      embedding_dimension: 768,
      normalization_policy: "l2-unit-v1",
      input_text: "chunk-0",
      source_start: 0,
      source_end: 7,
    });
    expect(state.saved[0].provider_input_text).toBe("title: Policies | text: chunk-0");
    expect(state.saved[0].input_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.rpcCalls).toEqual([
      "claim_document_embedding_job",
      "persist_document_embedding_batch",
      "finish_document_embedding_job",
    ]);
  });

  it("reuses existing records and returns ready without regenerating vectors", async () => {
    const state = stateWith();
    const first = makeProvider();
    await processDocumentEmbeddings(createClient(state), first.provider, documentId, userId);
    state.ready = true;
    const second = makeProvider();

    const result = await processDocumentEmbeddings(createClient(state), second.provider, documentId, userId);
    expect(result).toMatchObject({ status: "ready", partCount: 1, reusedCount: 1 });
    expect(second.provider.embedDocuments).not.toHaveBeenCalled();
  });

  it("resumes safely after a partial persistence failure without re-embedding saved parts", async () => {
    const state = stateWith(createChunks(33));
    state.failPersistOnCall = 2;
    const initial = makeProvider();
    const failed = await processDocumentEmbeddings(createClient(state), initial.provider, documentId, userId);
    expect(failed).toMatchObject({ status: "failed", errorCode: "PERSISTENCE_FAILED" });
    expect(state.saved).toHaveLength(32);
    expect(state.failed).toBe(true);

    const retry = makeProvider();
    const completed = await processDocumentEmbeddings(createClient(state), retry.provider, documentId, userId);
    expect(completed).toMatchObject({ status: "ready", partCount: 33 });
    expect(state.saved).toHaveLength(33);
    expect(completed.reusedCount).toBe(32);
    expect(retry.provider.embedDocuments).toHaveBeenCalledTimes(1);
    expect(state.failed).toBe(true);
  });

  it("does not report a terminal failure when the job failure transition could not be persisted", async () => {
    const state = stateWith();
    state.failPersistOnCall = 1;
    state.failStatusUpdate = true;
    const { provider } = makeProvider();

    const result = await processDocumentEmbeddings(createClient(state), provider, documentId, userId);

    expect(result).toEqual({ status: "processing", partCount: 1, reusedCount: 0 });
    expect(state.rpcCalls).toContain("fail_document_embedding_job");
  });

  it("does not process another user's document", async () => {
    const state = stateWith();
    const { provider } = makeProvider();
    const result = await processDocumentEmbeddings(createClient(state, "other-user"), provider, documentId, userId);
    expect(result).toEqual({ status: "not_found", partCount: 0, reusedCount: 0 });
    expect(provider.embedDocuments).not.toHaveBeenCalled();
  });

  it("rejects stale saved identity data instead of overwriting the prior embedding", async () => {
    const state = stateWith();
    const first = makeProvider();
    await processDocumentEmbeddings(createClient(state), first.provider, documentId, userId);
    state.ready = false;
    state.saved[0].input_content_hash = "f".repeat(64);
    const retry = makeProvider();

    const result = await processDocumentEmbeddings(createClient(state), retry.provider, documentId, userId);
    expect(result).toMatchObject({ status: "failed", errorCode: "INVALID_INPUT" });
    expect(retry.provider.embedDocuments).not.toHaveBeenCalled();
    expect(state.saved[0].input_content_hash).toBe("f".repeat(64));
  });

  it("does not reuse a stored vector that fails its dimension or normalization contract", async () => {
    const state = stateWith();
    const first = makeProvider();
    await processDocumentEmbeddings(createClient(state), first.provider, documentId, userId);
    state.ready = false;
    state.saved[0].embedding = [0, ...Array.from({ length: 767 }, () => 0)];
    const retry = makeProvider();

    const result = await processDocumentEmbeddings(createClient(state), retry.provider, documentId, userId);
    expect(result).toMatchObject({ status: "failed", errorCode: "INVALID_INPUT" });
    expect(retry.provider.embedDocuments).not.toHaveBeenCalled();
  });

  it("does not start duplicate work while a database claim is active", async () => {
    const state = stateWith();
    state.activeProcessing = true;
    const { provider } = makeProvider();

    const result = await processDocumentEmbeddings(createClient(state), provider, documentId, userId);
    expect(result).toMatchObject({ status: "processing" });
    expect(provider.embedDocuments).not.toHaveBeenCalled();
  });

  it("persists derived parts without changing their source offsets or order", async () => {
    const state = stateWith();
    const { provider } = makeProvider();
    vi.mocked(provider.prepareDocuments).mockResolvedValue([0, 1].map(partIndex => ({
      input: {
        id: `chunk-id-0:part-${partIndex}`,
        sourceChunkId: "chunk-id-0",
        partIndex,
        documentId,
        ownerId: userId,
        title: "Policies",
        text: partIndex === 0 ? "chu" : "nk-0",
        contentHash: `part-hash-${partIndex}`,
        sourceContentHash: "0".repeat(64),
        sourceStart: partIndex === 0 ? 0 : 3,
        sourceEnd: partIndex === 0 ? 3 : 7,
      },
      tokenCount: 3,
    })));

    const result = await processDocumentEmbeddings(createClient(state), provider, documentId, userId);
    expect(result).toMatchObject({ status: "ready", partCount: 2 });
    expect(state.saved.map(row => [row.part_index, row.input_text, row.source_start, row.source_end]))
      .toEqual([[0, "chu", 0, 3], [1, "nk-0", 3, 7]]);
  });

  it("fails closed when provider results do not match the configured identity", async () => {
    const state = stateWith();
    const { provider } = makeProvider();
    vi.mocked(provider.embedDocuments).mockResolvedValue([{
      values: vector,
      inputId: "chunk-id-0",
      sourceChunkId: "chunk-id-0",
      partIndex: 0,
      sourceStart: 0,
      sourceEnd: 7,
      identity: { ...identity, dimension: 384 },
    }]);

    const result = await processDocumentEmbeddings(createClient(state), provider, documentId, userId);
    expect(result).toMatchObject({ status: "failed", errorCode: "INVALID_PROVIDER_RESPONSE" });
    expect(state.saved).toHaveLength(0);
    expect(state.failed).toBe(true);
  });
});
