import { createHash } from "node:crypto";
import { EmbeddingProviderError } from "./errors";
import type { EmbeddingDocumentInput } from "./provider";

const MAX_TOKEN_COUNT_INPUT_CHARACTERS = 8_000;
const MAX_PREPARED_INPUTS_PER_DOCUMENT = 2_000;

export interface PreparedEmbeddingInput {
  input: EmbeddingDocumentInput;
  tokenCount: number;
}

export type TokenCounter = (text: string) => Promise<number>;

async function countSafely(countTokens: TokenCounter, text: string): Promise<number> {
  try {
    return await countTokens(text);
  } catch (error) {
    if (error instanceof EmbeddingProviderError) throw error;
    throw new EmbeddingProviderError("TOKEN_COUNT_FAILED", "Provider token counting failed.");
  }
}

function nextCodePointEnd(text: string, start: number, maxEnd: number): number {
  const codePoint = text.codePointAt(start);
  if (codePoint === undefined) return start;
  const width = codePoint > 0xffff ? 2 : 1;
  return start + width <= maxEnd ? start + width : start;
}

function cappedCodePointEnd(text: string, start: number, maxEnd: number): number {
  let end = start;
  while (end < maxEnd) {
    const next = nextCodePointEnd(text, end, maxEnd);
    if (next === end) break;
    end = next;
  }
  return end;
}

function validateInput(input: EmbeddingDocumentInput): void {
  if (!input.id.trim() || !input.text.length || !input.text.trim()) {
    throw new EmbeddingProviderError("INVALID_INPUT", "Embedding input must include an ID and non-empty text.");
  }
  const hasStart = input.sourceStart !== undefined;
  const hasEnd = input.sourceEnd !== undefined;
  if (hasStart !== hasEnd ||
      (hasStart && (!Number.isInteger(input.sourceStart) || !Number.isInteger(input.sourceEnd) ||
        input.sourceStart! < 0 || input.sourceEnd! - input.sourceStart! !== input.text.length))) {
    throw new EmbeddingProviderError("INVALID_INPUT", "Embedding source offsets do not match the input text.");
  }
}

function makeDerivedInput(
  input: EmbeddingDocumentInput,
  text: string,
  start: number,
  end: number,
  partIndex: number,
  isSplit: boolean,
): EmbeddingDocumentInput {
  return {
    ...input,
    id: isSplit ? `${input.id}:part-${partIndex}` : input.id,
    text,
    contentHash: isSplit
      ? createHash("sha256").update(text, "utf8").digest("hex")
      : input.contentHash,
    sourceContentHash: isSplit ? input.sourceContentHash ?? input.contentHash : input.sourceContentHash,
    sourceChunkId: input.sourceChunkId ?? input.id,
    partIndex: isSplit ? partIndex : input.partIndex ?? 0,
    sectionPath: input.sectionPath ? [...input.sectionPath] : undefined,
    sourceStart: input.sourceStart === undefined ? undefined : input.sourceStart + start,
    sourceEnd: input.sourceStart === undefined ? undefined : input.sourceStart + end,
  };
}

/**
 * Splits only at Unicode code-point boundaries. Every result is an exact,
 * non-overlapping slice of the original text; offsets remain UTF-16 offsets.
 */
export async function prepareEmbeddingInput(
  input: EmbeddingDocumentInput,
  countTokens: TokenCounter,
  maxInputTokens: number,
): Promise<PreparedEmbeddingInput[]> {
  validateInput(input);
  if (!Number.isInteger(maxInputTokens) || maxInputTokens < 1) {
    throw new EmbeddingProviderError("INVALID_INPUT", "The configured token limit is invalid.");
  }

  const pieces: Array<{ text: string; start: number; end: number; tokenCount: number }> = [];
  let cursor = 0;
  while (cursor < input.text.length) {
    const maxEnd = cappedCodePointEnd(
      input.text,
      cursor,
      Math.min(input.text.length, cursor + MAX_TOKEN_COUNT_INPUT_CHARACTERS),
    );
    if (maxEnd === cursor) {
      throw new EmbeddingProviderError("INPUT_TOO_LARGE", "A Unicode character cannot fit within the configured token limit.");
    }

    const candidate = input.text.slice(cursor, maxEnd);
    const candidateTokens = await countSafely(countTokens, candidate);
    if (!Number.isInteger(candidateTokens) || candidateTokens < 0) {
      throw new EmbeddingProviderError("TOKEN_COUNT_FAILED", "The provider returned an invalid token count.");
    }
    if (candidateTokens <= maxInputTokens) {
      pieces.push({ text: candidate, start: cursor, end: maxEnd, tokenCount: candidateTokens });
      cursor = maxEnd;
    } else {
      const boundaries: number[] = [];
      for (let end = cursor; end < maxEnd;) {
        end = nextCodePointEnd(input.text, end, maxEnd);
        if (end > cursor) boundaries.push(end);
      }

      let low = 0;
      let high = boundaries.length - 2;
      let bestEnd = cursor;
      let bestTokenCount = 0;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const end = boundaries[middle];
        const tokenCount = await countSafely(countTokens, input.text.slice(cursor, end));
        if (!Number.isInteger(tokenCount) || tokenCount < 0) {
          throw new EmbeddingProviderError("TOKEN_COUNT_FAILED", "The provider returned an invalid token count.");
        }
        if (tokenCount <= maxInputTokens) {
          bestEnd = end;
          bestTokenCount = tokenCount;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (bestEnd === cursor) {
        throw new EmbeddingProviderError("INPUT_TOO_LARGE", "Input cannot be split to fit the configured token limit.");
      }
      pieces.push({
        text: input.text.slice(cursor, bestEnd),
        start: cursor,
        end: bestEnd,
        tokenCount: bestTokenCount,
      });
      cursor = bestEnd;
    }

    if (pieces.length > MAX_PREPARED_INPUTS_PER_DOCUMENT) {
      throw new EmbeddingProviderError("INPUT_TOO_LARGE", "Input requires too many safe embedding pieces.");
    }
  }

  const split = pieces.length > 1;
  return pieces.map((piece, index) => ({
    input: makeDerivedInput(input, piece.text, piece.start, piece.end, index, split),
    tokenCount: piece.tokenCount,
  }));
}

export function groupEmbeddingRequests<T extends { tokenCount: number }>(
  inputs: readonly T[],
  maxInputs: number,
  maxRequestTokens: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;
  for (const item of inputs) {
    if (!Number.isInteger(item.tokenCount) || item.tokenCount < 0 || item.tokenCount > maxRequestTokens) {
      throw new EmbeddingProviderError(
        "AGGREGATE_TOKEN_BUDGET_EXCEEDED",
        "An embedding input exceeds the configured request token budget.",
      );
    }
    if (current.length > 0 &&
        (current.length >= maxInputs || currentTokens + item.tokenCount > maxRequestTokens)) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(item);
    currentTokens += item.tokenCount;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
