import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

export const MAX_EXTRACTED_CHARACTERS = 500_000;
export const MAX_PDF_PAGES = 100;
export const EXTRACTION_TIMEOUT_MS = 15_000;
export const CANONICAL_SEGMENT_SEPARATOR = "\n\n";

export type ExtractionFormat = "pdf" | "docx" | "txt" | "md" | "markdown";

export interface ExtractedSegment {
  text: string;
  pageStart?: number;
  pageEnd?: number;
  sectionPath?: string[];
}

export interface ExtractedDocument {
  format: ExtractionFormat;
  segments: ExtractedSegment[];
  characterCount: number;
  pageCount?: number;
}

/**
 * Returns the exact text persisted for an extracted document. Offsets into
 * this string are zero-based, end-exclusive JavaScript string offsets.
 */
export function buildCanonicalText(document: Pick<ExtractedDocument, "segments">): string {
  return document.segments.map(segment => segment.text).join(CANONICAL_SEGMENT_SEPARATOR);
}

export type ExtractionErrorCode =
  | "UNSUPPORTED_FORMAT"
  | "INVALID_SIGNATURE"
  | "MALFORMED_DOCUMENT"
  | "ENCRYPTED_DOCUMENT"
  | "EMPTY_DOCUMENT"
  | "EXTRACTION_LIMIT"
  | "EXTRACTION_TIMEOUT";

export class ExtractionError extends Error {
  constructor(
    public readonly code: ExtractionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

function normalizeText(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countCharacters(segments: ExtractedSegment[]): number {
  return segments.reduce((total, segment) => total + segment.text.length, 0);
}

function enforceMeaningfulText(
  format: ExtractionFormat,
  segments: ExtractedSegment[],
  pageCount?: number,
): ExtractedDocument {
  const normalized = segments
    .map(segment => ({ ...segment, text: normalizeText(segment.text) }))
    .filter(segment => segment.text.length > 0);
  const characterCount = countCharacters(normalized);
  if (characterCount === 0) {
    throw new ExtractionError("EMPTY_DOCUMENT", "The document contains no extractable text.");
  }
  if (characterCount > MAX_EXTRACTED_CHARACTERS) {
    throw new ExtractionError("EXTRACTION_LIMIT", "Extracted text exceeds the safe processing limit.");
  }
  return { format, segments: normalized, characterCount, pageCount };
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExtractionError(
      "EXTRACTION_TIMEOUT",
      "Document extraction exceeded the processing time limit.",
    )), EXTRACTION_TIMEOUT_MS);
    promise.then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractedDocument> {
  if (!hasPdfSignature(bytes)) {
    throw new ExtractionError("INVALID_SIGNATURE", "The file is not a valid PDF.");
  }
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await withTimeout(parser.getText());
    if (result.total > MAX_PDF_PAGES) {
      throw new ExtractionError("EXTRACTION_LIMIT", "The PDF exceeds the page limit.");
    }
    return enforceMeaningfulText(
      "pdf",
      result.pages.map(page => ({ text: page.text, pageStart: page.num, pageEnd: page.num })),
      result.total,
    );
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("password") || message.includes("encrypt")) {
      throw new ExtractionError("ENCRYPTED_DOCUMENT", "Password-protected PDFs are not supported.");
    }
    throw new ExtractionError("MALFORMED_DOCUMENT", "The PDF could not be safely parsed.");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractedDocument> {
  if (!hasZipSignature(bytes)) {
    throw new ExtractionError("INVALID_SIGNATURE", "The file is not a valid DOCX document.");
  }
  try {
    const result = await withTimeout(mammoth.extractRawText({ buffer: Buffer.from(bytes) }));
    return enforceMeaningfulText("docx", [{ text: result.value }]);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("MALFORMED_DOCUMENT", "The DOCX document could not be safely parsed.");
  }
}

function extractText(bytes: Uint8Array, format: "txt" | "md" | "markdown"): ExtractedDocument {
  const value = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return enforceMeaningfulText(format, [{ text: value }]);
}

export async function extractDocument(
  bytes: Uint8Array,
  format: ExtractionFormat,
): Promise<ExtractedDocument> {
  if (bytes.length === 0) {
    throw new ExtractionError("EMPTY_DOCUMENT", "The document is empty.");
  }
  switch (format) {
    case "pdf": return extractPdf(bytes);
    case "docx": return extractDocx(bytes);
    case "txt":
    case "md":
    case "markdown":
      return extractText(bytes, format);
    default:
      throw new ExtractionError("UNSUPPORTED_FORMAT", "This document format is not supported.");
  }
}
