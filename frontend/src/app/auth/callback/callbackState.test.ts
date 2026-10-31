import { describe, expect, it } from "vitest";
import { readCallbackUrl } from "./callbackState";

describe("verification callback URL handling", () => {
  it("reads a PKCE code", () => {
    expect(readCallbackUrl("http://localhost/auth/callback?code=verified-code")).toEqual({
      code: "verified-code", errorDescription: null,
    });
  });
  it("reads explicit callback errors", () => {
    expect(readCallbackUrl("https://example.com/auth/callback?error=access_denied&error_description=expired").errorDescription).toBe("expired");
  });
  it("reads hash callback errors used by implicit flows", () => {
    expect(readCallbackUrl("https://example.com/auth/callback#error=access_denied&error_description=invalid-link").errorDescription).toBe("invalid-link");
  });
});
