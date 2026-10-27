import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  createServiceRoleSupabaseClient: vi.fn(),
  processIngestionJob: vi.fn(),
}));

vi.mock("@/lib/supabase/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleSupabaseClient: mocks.createServiceRoleSupabaseClient }));
vi.mock("@/lib/ingestion/ingestionService", () => ({ processIngestionJob: mocks.processIngestionJob }));

import { POST } from "./route";

const documentId = "11111111-1111-4111-8111-111111111111";
const context = { params: Promise.resolve({ documentId }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateRequest.mockResolvedValue({ user: { id: "22222222-2222-4222-8222-222222222222" } });
  mocks.createServiceRoleSupabaseClient.mockReturnValue({});
});

describe("document processing route", () => {
  it("requires authentication and ownership-scoped processing", async () => {
    mocks.authenticateRequest.mockResolvedValue({ error: true, code: "UNAUTHENTICATED", message: "Authentication is required." });
    expect((await POST(new Request("http://localhost"), context)).status).toBe(401);
    expect(mocks.processIngestionJob).not.toHaveBeenCalled();

    mocks.authenticateRequest.mockResolvedValue({ user: { id: "user-a" } });
    mocks.processIngestionJob.mockResolvedValue({ status: "ready", chunkCount: 2 });
    expect((await POST(new Request("http://localhost"), context)).status).toBe(200);
    expect(mocks.processIngestionJob).toHaveBeenCalledWith({}, documentId, "user-a");
  });

  it("maps failed processing without exposing parser details", async () => {
    mocks.processIngestionJob.mockResolvedValue({ status: "failed", errorCode: "MALFORMED_DOCUMENT", chunkCount: 0 });
    const response = await POST(new Request("http://localhost"), context);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.message).not.toContain("stack");
    expect(body.error.message).not.toContain("PDF");
  });
});
