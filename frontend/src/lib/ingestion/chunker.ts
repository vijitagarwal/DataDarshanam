import { buildCanonicalText, CANONICAL_SEGMENT_SEPARATOR, type ExtractedDocument, type ExtractedSegment } from "./extraction";

export const DEFAULT_CHUNK_SIZE = 4_000;
export const DEFAULT_CHUNK_OVERLAP = 600;
export const MAX_CHUNKS_PER_DOCUMENT = 2_000;

export interface ChunkingOptions {
  chunkSize: number;
  overlap: number;
  maxChunks?: number;
}

export interface DocumentChunk {
  chunkIndex: number;
  text: string;
  pageStart?: number;
  pageEnd?: number;
  sectionPath?: string[];
  sourceStart: number;
  sourceEnd: number;
}

function validateOptions(options: ChunkingOptions): void {
  if (!Number.isInteger(options.chunkSize) || options.chunkSize < 256) {
    throw new Error("chunkSize must be an integer of at least 256 characters.");
  }
  if (!Number.isInteger(options.overlap) || options.overlap < 0 || options.overlap >= options.chunkSize) {
    throw new Error("overlap must be non-negative and smaller than chunkSize.");
  }
}

function sourceMetadata(
  segments: Array<{ segment: ExtractedSegment; start: number; end: number }>,
  start: number,
  end: number,
): Pick<DocumentChunk, "pageStart" | "pageEnd" | "sectionPath"> {
  const touched = segments.filter(range => range.start < end && range.end > start);
  const first = touched[0]?.segment;
  const last = touched[touched.length - 1]?.segment;
  return {
    pageStart: first?.pageStart,
    pageEnd: last?.pageEnd,
    sectionPath: first?.sectionPath,
  };
}

function splitCanonicalText(
  document: ExtractedDocument,
  canonicalText: string,
  options: ChunkingOptions,
): DocumentChunk[] {
  const ranges: Array<{ segment: ExtractedSegment; start: number; end: number }> = [];
  let segmentStart = 0;
  for (const [index, segment] of document.segments.entries()) {
    const segmentEnd = segmentStart + segment.text.length;
    ranges.push({ segment, start: segmentStart, end: segmentEnd });
    segmentStart = segmentEnd + (index < document.segments.length - 1 ? CANONICAL_SEGMENT_SEPARATOR.length : 0);
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  while (start < canonicalText.length) {
    const end = Math.min(start + options.chunkSize, canonicalText.length);
    const raw = canonicalText.slice(start, end);
    const leadingWhitespace = raw.search(/\S/);
    const trailingWhitespaceMatch = raw.match(/\s+$/);
    const actualStart = start + Math.max(leadingWhitespace, 0);
    const actualEnd = end - (trailingWhitespaceMatch?.[0].length ?? 0);
    const text = canonicalText.slice(actualStart, actualEnd);
    if (text) {
      const metadata = sourceMetadata(ranges, actualStart, actualEnd);
      chunks.push({
        chunkIndex: -1,
        text,
        ...metadata,
        sourceStart: actualStart,
        sourceEnd: actualEnd,
      });
    }
    if (end === canonicalText.length) break;
    start = end - options.overlap;
  }
  return chunks;
}

export function chunkDocument(
  document: ExtractedDocument,
  options: ChunkingOptions = {
    chunkSize: DEFAULT_CHUNK_SIZE,
    overlap: DEFAULT_CHUNK_OVERLAP,
  },
): DocumentChunk[] {
  validateOptions(options);
  const chunks = splitCanonicalText(document, buildCanonicalText(document), options);
  const maxChunks = options.maxChunks ?? MAX_CHUNKS_PER_DOCUMENT;
  if (chunks.length > maxChunks) {
    throw new Error("Document produces more chunks than the safe processing limit.");
  }
  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index }));
}
