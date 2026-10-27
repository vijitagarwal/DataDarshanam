import { describe, expect, it, vi } from "vitest";
import { EmbeddingProviderError } from "./errors";
import { groupEmbeddingRequests, prepareEmbeddingInput } from "./prepare";

describe("embedding input preparation", () => {
  it("accepts inputs immediately below and at the provider token limit", async () => {
    const countTokens = vi.fn(async (text: string) => text.length);
    const below = await prepareEmbeddingInput({ id: "below", text: "abc" }, countTokens, 4);
    const at = await prepareEmbeddingInput({ id: "at", text: "abcd" }, countTokens, 4);

    expect(below.map(part => part.input.text)).toEqual(["abc"]);
    expect(at.map(part => part.input.text)).toEqual(["abcd"]);
    expect(below[0].tokenCount).toBe(3);
    expect(at[0].tokenCount).toBe(4);
  });

  it("splits an over-limit chunk deterministically without losing or overlapping text", async () => {
    const countTokens = vi.fn(async (text: string) => text.length);
    const input = {
      id: "chunk-1",
      documentId: "doc-1",
      ownerId: "owner-1",
      text: "abcdefghij",
      sourceStart: 50,
      sourceEnd: 60,
      contentHash: "original-hash",
      pageStart: 3,
      pageEnd: 3,
      sectionPath: ["Policy"],
    };
    const first = await prepareEmbeddingInput(input, countTokens, 4);
    const second = await prepareEmbeddingInput(input, countTokens, 4);

    expect(first).toEqual(second);
    expect(first.map(part => part.input.text)).toEqual(["abcd", "efgh", "ij"]);
    expect(first.map(part => part.input.id)).toEqual([
      "chunk-1:part-0", "chunk-1:part-1", "chunk-1:part-2",
    ]);
    expect(first.map(part => [part.input.sourceStart, part.input.sourceEnd])).toEqual([
      [50, 54], [54, 58], [58, 60],
    ]);
    expect(first.map(part => part.tokenCount)).toEqual([4, 4, 2]);
    expect(first.every(part => part.input.documentId === "doc-1" &&
      part.input.ownerId === "owner-1" && part.input.pageStart === 3 &&
      part.input.sectionPath?.[0] === "Policy")).toBe(true);
    expect(first.every(part => part.input.contentHash !== "original-hash")).toBe(true);
    expect(first.every(part => part.input.sourceContentHash === "original-hash")).toBe(true);
    expect(first.map(part => part.input.text).join("")).toBe(input.text);
  });

  it("uses exact token counts even when character length is below the old safety bound", async () => {
    const countTokens = vi.fn(async (text: string) => Math.ceil(text.length / 2));
    const parts = await prepareEmbeddingInput({ id: "unicode", text: "a".repeat(101) }, countTokens, 25);

    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(part => part.tokenCount <= 25)).toBe(true);
    expect(parts.map(part => part.input.text).join("")).toBe("a".repeat(101));
  });

  it("never splits surrogate pairs and preserves UTF-16 source offsets", async () => {
    const text = "😀界😀abc";
    const input = { id: "unicode", text, sourceStart: 12, sourceEnd: 12 + text.length };
    const parts = await prepareEmbeddingInput(input, async value => Array.from(value).length, 2);

    expect(parts.map(part => part.input.text).join("")).toBe(text);
    for (const part of parts) {
      expect(text.slice(
        part.input.sourceStart! - input.sourceStart!,
        part.input.sourceEnd! - input.sourceStart!,
      )).toBe(part.input.text);
      expect(part.input.text).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(part.input.text).not.toMatch(/^[\uDC00-\uDFFF]/);
    }
  });

  it("preserves whitespace and rejects unsafe offsets or token-count failures", async () => {
    const text = "paragraph\n\n   with a long tail";
    const parts = await prepareEmbeddingInput(
      { id: "spaces", text, sourceStart: 0, sourceEnd: text.length },
      async value => value.length,
      9,
    );
    expect(parts.map(part => part.input.text).join("")).toBe(text);

    await expect(prepareEmbeddingInput(
      { id: "bad-offset", text: "abc", sourceStart: 0, sourceEnd: 2 },
      async value => value.length,
      10,
    )).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(prepareEmbeddingInput(
      { id: "count-failure", text: "abc" },
      async () => { throw new Error("sensitive provider detail"); },
      10,
    )).rejects.toMatchObject({
      code: "TOKEN_COUNT_FAILED",
      message: "Provider token counting failed.",
    });
  });

  it("fails safely when one code point cannot fit and groups by count and input count", async () => {
    await expect(prepareEmbeddingInput(
      { id: "too-large", text: "x" },
      async () => 2,
      1,
    )).rejects.toBeInstanceOf(EmbeddingProviderError);

    const items = [{ tokenCount: 4, id: "a" }, { tokenCount: 4, id: "b" }, { tokenCount: 3, id: "c" }];
    expect(groupEmbeddingRequests(items, 2, 8).map(batch => batch.map(item => item.id)))
      .toEqual([["a", "b"], ["c"]]);
    expect(() => groupEmbeddingRequests([{ tokenCount: 9 }], 32, 8))
      .toThrowError(EmbeddingProviderError);
  });
});
