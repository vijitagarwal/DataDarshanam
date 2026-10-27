import { describe, expect, it } from "vitest";
import {
  ALLOWED_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  createStoragePath,
  getExtension,
  isSafeStoragePath,
  validateUploadMetadata,
} from "./documents";

describe("document upload validation", () => {
  it("accepts supported formats only with matching media types", () => {
    for (const [extension, mediaType] of Object.entries(ALLOWED_DOCUMENTS)) {
      expect(validateUploadMetadata({
        filename: `policy.${extension}`,
        mediaType,
        byteSize: 100,
      })).toMatchObject({ valid: true, extension });
    }
    expect(getExtension("policy.exe")).toBeNull();
    expect(validateUploadMetadata({
      filename: "policy.pdf",
      mediaType: "text/plain",
      byteSize: 100,
    })).toMatchObject({ valid: false });
  });

  it("rejects invalid and oversized metadata", () => {
    expect(validateUploadMetadata(null)).toMatchObject({ valid: false });
    expect(validateUploadMetadata({ filename: "policy.pdf", mediaType: "application/pdf", byteSize: 0 })).toMatchObject({ valid: false });
    expect(validateUploadMetadata({ filename: "policy.pdf", mediaType: "application/pdf", byteSize: MAX_DOCUMENT_BYTES + 1 })).toMatchObject({ valid: false });
    expect(validateUploadMetadata({ filename: "../policy.pdf", mediaType: "application/pdf", byteSize: 100 })).toMatchObject({ valid: true });
  });

  it("only accepts server-generated ownership-bound storage paths", () => {
    const path = createStoragePath("user-a", "11111111-1111-4111-8111-111111111111", "pdf");
    expect(isSafeStoragePath(path, "user-a", "11111111-1111-4111-8111-111111111111", "pdf")).toBe(true);
    expect(isSafeStoragePath(path, "user-b", "11111111-1111-4111-8111-111111111111", "pdf")).toBe(false);
    expect(isSafeStoragePath("../user-a/file.pdf", "user-a", "11111111-1111-4111-8111-111111111111", "pdf")).toBe(false);
  });
});
