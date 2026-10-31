import { describe, expect, it, vi } from "vitest";
import { completeCallbackSession } from "./callbackSession";

describe("PKCE callback session handling", () => {
  it("exchanges the code and establishes the returned session", async () => {
    const auth = {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } }, error: null }),
    };
    await expect(completeCallbackSession("http://localhost/auth/callback?code=verified-code", auth)).resolves.toEqual({
      status: "authenticated",
      redirectTo: "/",
    });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("verified-code");
  });

  it("handles confirmed email without an automatic session", async () => {
    const auth = {
      exchangeCodeForSession: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    };
    await expect(completeCallbackSession("http://localhost/auth/callback", auth)).resolves.toEqual({
      status: "verified",
      message: "Your email has been verified. Sign in to continue.",
    });
  });

  it("handles expired links and failed exchanges", async () => {
    const expiredAuth = { exchangeCodeForSession: vi.fn(), getSession: vi.fn() };
    await expect(completeCallbackSession("http://localhost/auth/callback#error=access_denied&error_description=expired", expiredAuth)).resolves.toMatchObject({ status: "invalid" });

    const failedAuth = {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: new Error("invalid code") }),
      getSession: vi.fn(),
    };
    await expect(completeCallbackSession("http://localhost/auth/callback?code=expired", failedAuth)).resolves.toMatchObject({ status: "invalid" });
  });

  it("does not authenticate when reading the session fails", async () => {
    const auth = {
      exchangeCodeForSession: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: new Error("session unavailable") }),
    };
    await expect(completeCallbackSession("http://localhost/auth/callback?code=verified-code", auth)).resolves.toMatchObject({ status: "invalid" });
  });
});
