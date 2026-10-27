import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  uploadToSignedUrl: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabaseClient: () => ({
    auth: { getSession: mocks.getSession, signOut: mocks.signOut },
    storage: { from: mocks.from },
  }),
}));

import { listDocuments, uploadDocument } from "./documentApi";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: { access_token: "access-token" } } });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.uploadToSignedUrl.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ uploadToSignedUrl: mocks.uploadToSignedUrl });
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      document: { id: "11111111-1111-4111-8111-111111111111", display_name: "policy.pdf", status: "awaiting_upload" },
      upload: { bucket: "documents", path: "user-a/11111111-1111-4111-8111-111111111111/original.pdf", token: "signed-upload-token" },
    }), { status: 201 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      document_id: "11111111-1111-4111-8111-111111111111",
      status: "queued",
    }), { status: 200 })));
});

describe("browser document upload workflow", () => {
  it("loads an empty document list through the authenticated document API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      documents: [],
    }), { status: 200 })));

    await expect(listDocuments()).resolves.toEqual([]);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/documents", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
    }));
  });

  it("surfaces document list API failures without inventing a retry endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: { code: "DATABASE_ERROR", message: "Unable to load documents." },
    }), { status: 500 })));

    await expect(listDocuments()).rejects.toThrow("Unable to load documents.");
  });

  it("uses the server-issued signed token and exact ownership-bound path", async () => {
    const file = new File(["policy"], "policy.pdf", { type: "application/pdf" });
    await uploadDocument(file);

    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(
      "user-a/11111111-1111-4111-8111-111111111111/original.pdf",
      "signed-upload-token",
      file,
    );
    expect(vi.mocked(fetch).mock.calls[1][1]).toMatchObject({
      headers: { Authorization: "Bearer access-token", "Content-Type": "application/json" },
    });
  });

  it("signs out and fails cleanly when the session is expired", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });

    await expect(uploadDocument(new File(["policy"], "policy.pdf", { type: "application/pdf" })))
      .rejects.toThrow("session has expired");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not call completion when signed upload fails", async () => {
    mocks.uploadToSignedUrl.mockResolvedValue({ error: new Error("storage detail") });
    await expect(uploadDocument(new File(["policy"], "policy.pdf", { type: "application/pdf" })))
      .rejects.toThrow("could not be uploaded securely");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
});
