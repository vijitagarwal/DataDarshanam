import { describe, expect, it, vi } from "vitest";
import { getOwnedDocument } from "./documentAccess";

function clientFor(result: { data: unknown; error: Error | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eqUser = vi.fn().mockReturnValue({ maybeSingle });
  const eqDocument = vi.fn().mockReturnValue({ eq: eqUser });
  const select = vi.fn().mockReturnValue({ eq: eqDocument });
  return {
    client: { from: vi.fn().mockReturnValue({ select }) } as never,
    select,
    eqDocument,
    eqUser,
  };
}

describe("document ownership boundary", () => {
  it("includes the authenticated user in every document lookup", async () => {
    const owned = { id: "doc-a", user_id: "user-a", display_name: "Policy", status: "ready" };
    const { client, eqDocument, eqUser } = clientFor({ data: owned, error: null });

    const result = await getOwnedDocument(client, "user-a", "doc-a");

    expect(result).toEqual({ document: owned, error: null });
    expect(eqDocument).toHaveBeenCalledWith("id", "doc-a");
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-a");
  });

  it("treats another user's document as not found", async () => {
    const { client } = clientFor({ data: null, error: null });

    await expect(getOwnedDocument(client, "user-b", "doc-a")).resolves.toEqual({
      document: null,
      error: null,
    });
  });
});
