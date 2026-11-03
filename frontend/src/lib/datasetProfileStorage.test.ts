import { describe, expect, it } from "vitest";
import { isStoredProfileCompatible } from "./datasetProfileStorage";

const validProfile = {
  profile_version: 1,
  source_hash: "hash-a",
  rows: 10,
  column_count: 2,
  columns: [
    { name: "x", dtype: "object", role: "categorical" },
    { name: "y", dtype: "float64", role: "numeric" },
  ],
  numeric_columns: ["y"],
  categorical_columns: ["x"],
  date_columns: [],
  text_columns: [],
};

describe("stored dataset profile compatibility", () => {
  it("accepts a matching persisted profile on reload", () => {
    expect(isStoredProfileCompatible(validProfile, "hash-a", 10, 2)).toBe(true);
  });
  it("rejects stale, malformed, and version-mismatched profiles", () => {
    expect(isStoredProfileCompatible(validProfile, "hash-b", 10, 2)).toBe(false);
    expect(isStoredProfileCompatible({ ...validProfile, profile_version: 2 }, "hash-a", 10, 2)).toBe(false);
    expect(isStoredProfileCompatible({ ...validProfile, rows: 11 }, "hash-a", 10, 2)).toBe(false);
    expect(isStoredProfileCompatible({ ...validProfile, columns: null }, "hash-a", 10, 2)).toBe(false);
    expect(isStoredProfileCompatible({ ...validProfile, columns: [{ name: "x" }, { name: "y" }] }, "hash-a", 10, 2)).toBe(false);
  });
});
