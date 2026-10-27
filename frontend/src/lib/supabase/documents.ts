import { randomUUID } from "node:crypto";

export const DOCUMENT_BUCKET = "documents";
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_DOCUMENTS = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
} as const;

export type DocumentExtension = keyof typeof ALLOWED_DOCUMENTS;

export interface DocumentUploadMetadata {
  filename: string;
  mediaType: string;
  byteSize: number;
  displayName?: string;
}

export function getExtension(filename: string): DocumentExtension | null {
  const match = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match?.[1] as DocumentExtension | undefined;
  return extension && extension in ALLOWED_DOCUMENTS ? extension : null;
}

export function validateUploadMetadata(input: unknown):
  | { valid: true; metadata: DocumentUploadMetadata; extension: DocumentExtension }
  | { valid: false; message: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, message: "Upload metadata must be a JSON object." };
  }
  const value = input as Record<string, unknown>;
  if (typeof value.filename !== "string" || value.filename.trim().length === 0 || value.filename.length > 255) {
    return { valid: false, message: "Filename must be a non-empty value of at most 255 characters." };
  }
  const extension = getExtension(value.filename);
  if (!extension) return { valid: false, message: "Only PDF, DOCX, TXT, and Markdown files are supported." };
  if (typeof value.mediaType !== "string" || value.mediaType !== ALLOWED_DOCUMENTS[extension]) {
    return { valid: false, message: "The declared media type does not match the file extension." };
  }
  if (typeof value.byteSize !== "number" || !Number.isInteger(value.byteSize) || value.byteSize < 1 || value.byteSize > MAX_DOCUMENT_BYTES) {
    return { valid: false, message: `File size must be an integer between 1 and ${MAX_DOCUMENT_BYTES} bytes.` };
  }
  if (value.displayName !== undefined &&
      (typeof value.displayName !== "string" || value.displayName.trim().length === 0 || value.displayName.length > 200)) {
    return { valid: false, message: "Display name must be a non-empty value of at most 200 characters." };
  }
  return {
    valid: true,
    extension,
    metadata: {
      filename: value.filename.trim(),
      mediaType: value.mediaType,
      byteSize: value.byteSize,
      displayName: typeof value.displayName === "string" ? value.displayName.trim() : undefined,
    },
  };
}

export function createStoragePath(userId: string, documentId: string, extension: DocumentExtension): string {
  return `${userId}/${documentId}/original.${extension}`;
}

export function createDocumentId(): string {
  return randomUUID();
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isSafeStoragePath(path: unknown, userId: string, documentId: string, extension: DocumentExtension): boolean {
  return typeof path === "string" &&
    path === createStoragePath(userId, documentId, extension) &&
    !path.includes("..");
}
