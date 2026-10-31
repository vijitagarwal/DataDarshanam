import { describe, expect, it } from "vitest";
import { validateRegistration } from "./registration";

const valid = { fullName: "Ada Lovelace", email: "ada@example.com", password: "StrongPass1", confirmPassword: "StrongPass1" };

describe("registration validation", () => {
  it("accepts a complete registration", () => expect(validateRegistration(valid)).toEqual({ valid: true }));
  it("rejects whitespace-only names", () => expect(validateRegistration({ ...valid, fullName: "   " })).toMatchObject({ valid: false }));
  it("rejects invalid email", () => expect(validateRegistration({ ...valid, email: "invalid" })).toMatchObject({ valid: false }));
  it("rejects weak passwords and mismatches", () => {
    expect(validateRegistration({ ...valid, password: "weak" })).toMatchObject({ valid: false });
    expect(validateRegistration({ ...valid, confirmPassword: "OtherPass1" })).toMatchObject({ valid: false });
  });
});
