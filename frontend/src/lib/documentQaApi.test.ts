import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  askDocumentQuestion,
  DocumentQaApiError,
  validateDocumentAnswer,
} from "./documentQaApi";
import type { DocumentItem } from "./documentApi";
import {
  acquireSubmission,
  releaseSubmission,
  resolveDocumentScope,
  toggleSelectedDocument,
} from "./documentQaState";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabaseClient: () => ({
    auth: { getSession: mocks.getSession, signOut: mocks.signOut },
  }),
}));

const documentOne: DocumentItem = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "Policy",
  original_filename: "policy.pdf",
  media_type: "application/pdf",
  byte_size: 100,
  status: "ready",
  chunk_count: 2,
  created_at: "",
  updated_at: "",
  completed_at: null,
  deleted_at: null,
  ingestion_error_code: null,
};
const documentTwo: DocumentItem = { ...documentOne, id: "22222222-2222-4222-8222-222222222222", status: "queued" };
const source = {
  documentId: documentOne.id,
  documentName: "Policy",
  chunkId: "33333333-3333-4333-8333-333333333333",
  chunkIndex: 0,
  sourceStart: 10,
  sourceEnd: 32,
  pageStart: 2,
  pageEnd: 2,
  sectionPath: ["Leave"],
};

function answerResponse(status = "answered", answer: string | null = "Twenty days.", sources: unknown[] = [source]) {
  return { success: true, status, answer, sources };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "user-access-token" } } });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("document Q&A browser API", () => {
  it("sends the existing authenticated answer contract and validates grounded source metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(answerResponse()), { status: 200 }),
    ));

    await expect(askDocumentQuestion("  How many leave days?  ", [documentOne.id]))
      .resolves.toEqual({
        status: "answered",
        answer: "Twenty days.",
        sources: [source],
      });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/answers", expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer user-access-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question: "How many leave days?", documentIds: [documentOne.id] }),
    }));
  });

  it("omits documentIds when the user selected all documents", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, status: "no_evidence", answer: null, sources: [] }), { status: 200 }),
    ));
    await expect(askDocumentQuestion("Question?")).resolves.toMatchObject({ status: "no_evidence", sources: [] });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ question: "Question?" });
  });

  it("validates no-evidence and insufficient-evidence states without inventing sources", () => {
    expect(validateDocumentAnswer({ success: true, status: "no_evidence", answer: null, sources: [] }))
      .toEqual({ status: "no_evidence", answer: null, sources: [] });
    expect(validateDocumentAnswer(answerResponse("insufficient_evidence", "Not enough evidence.", [])))
      .toEqual({ status: "insufficient_evidence", answer: "Not enough evidence.", sources: [] });
    expect(validateDocumentAnswer(answerResponse("answered", "Answer.", []))).toBeNull();
    expect(validateDocumentAnswer(answerResponse("insufficient_evidence", "Not enough.", [source]))).toBeNull();
  });

  it("rejects malformed or fabricated source references and does not interpret answer text as HTML", () => {
    expect(validateDocumentAnswer(answerResponse("answered", "Answer.", [{ ...source, documentId: "other" }]))).toBeNull();
    expect(validateDocumentAnswer(answerResponse("answered", "Answer.", [{ ...source, sourceEnd: 0 }]))).toBeNull();
    const markup = "<img src=x onerror=alert(1)>";
    expect(validateDocumentAnswer(answerResponse("answered", markup))).toMatchObject({ answer: markup });
  });

  it("maps disabled, unauthorized, malformed, and network failures to safe messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: { code: "FEATURE_DISABLED", message: "technical details" },
    }), { status: 503 })));
    await expect(askDocumentQuestion("Question?")).rejects.toMatchObject({
      code: "FEATURE_DISABLED",
      message: "Document Q&A is not available yet. Please try again later.",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication is required." },
    }), { status: 401 })));
    await expect(askDocumentQuestion("Question?")).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(mocks.signOut).toHaveBeenCalledOnce();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{", { status: 200 })));
    await expect(askDocumentQuestion("Question?")).rejects.toBeInstanceOf(DocumentQaApiError);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network secret")));
    await expect(askDocumentQuestion("Question?")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.not.stringContaining("network secret"),
    });
  });

  it("rejects invalid questions and expired local sessions before sending requests", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(askDocumentQuestion("  ")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(askDocumentQuestion("x".repeat(5_001))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(askDocumentQuestion("Question?", ["invalid-id"])).rejects.toMatchObject({ code: "INVALID_INPUT" });

    mocks.getSession.mockResolvedValue({ data: { session: null } });
    await expect(askDocumentQuestion("Question?")).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("document Q&A scope and submission state", () => {
  it("toggles only selected IDs and scopes to ready documents", () => {
    const selected = toggleSelectedDocument([], documentOne.id);
    expect(selected).toEqual([documentOne.id]);
    expect(toggleSelectedDocument(selected, documentOne.id)).toEqual([]);
    expect(resolveDocumentScope([documentOne, documentTwo], [])).toBeUndefined();
    expect(resolveDocumentScope([documentOne, documentTwo], [documentOne.id, documentTwo.id]))
      .toEqual([documentOne.id]);
  });

  it("prevents duplicate pending submissions and releases the gate after completion", () => {
    const lock = { active: false };
    expect(acquireSubmission(lock)).toBe(true);
    expect(acquireSubmission(lock)).toBe(false);
    releaseSubmission(lock);
    expect(acquireSubmission(lock)).toBe(true);
  });
});
