import { describe, expect, it } from "vitest";
import { buildCanonicalText } from "./extraction";
import { chunkDocument } from "./chunker";

describe("document chunking", () => {
  it("keeps order, metadata, and configured overlap", () => {
    const first = "a".repeat(300);
    const second = "b".repeat(256);
    const chunks = chunkDocument({
      format: "pdf",
      characterCount: 556,
      pageCount: 2,
      segments: [
        { text: first, pageStart: 1, pageEnd: 1 },
        { text: second, pageStart: 2, pageEnd: 2 },
      ],
    }, { chunkSize: 256, overlap: 32 });

    const canonicalText = buildCanonicalText({
      segments: [
        { text: first, pageStart: 1, pageEnd: 1 },
        { text: second, pageStart: 2, pageEnd: 2 },
      ],
    });

    expect(chunks.map(chunk => chunk.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks[0]).toMatchObject({ text: first.slice(0, 256), pageStart: 1, sourceStart: 0 });
    expect(chunks[1]).toMatchObject({ sourceStart: 224, pageStart: 1, pageEnd: 2 });
    expect(chunks[2]).toMatchObject({ sourceStart: 448, pageStart: 2 });
    for (const chunk of chunks) {
      expect(canonicalText.slice(chunk.sourceStart, chunk.sourceEnd)).toBe(chunk.text);
    }
  });

  it("uses exact joined offsets for Unicode segments and crossing chunks", () => {
    const document = {
      format: "txt" as const,
      characterCount: 259,
      segments: [
        { text: "甲".repeat(250), sectionPath: ["First"] },
        { text: "😀世界abc", sectionPath: ["Second"] },
      ],
    };
    const canonicalText = buildCanonicalText(document);
    const chunks = chunkDocument(document, { chunkSize: 256, overlap: 0 });

    expect(canonicalText).toBe(`${"甲".repeat(250)}\n\n😀世界abc`);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ text: `${"甲".repeat(250)}\n\n😀世界`, sourceStart: 0, sourceEnd: 256 });
    expect(chunks[1]).toMatchObject({ text: "abc", sourceStart: 256, sourceEnd: 259 });
    for (const chunk of chunks) {
      expect(canonicalText.slice(chunk.sourceStart, chunk.sourceEnd)).toBe(chunk.text);
    }
  });

  it("omits empty content and preserves Unicode", () => {
    const chunks = chunkDocument({
      format: "md",
      characterCount: 8,
      segments: [{ text: "\n\n你好世界\n\n" }],
    }, { chunkSize: 256, overlap: 0 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("你好世界");
  });

  it("rejects unsafe configuration and excessive chunk counts", () => {
    const document = { format: "txt" as const, characterCount: 3, segments: [{ text: "abc" }] };
    expect(() => chunkDocument(document, { chunkSize: 128, overlap: 0 })).toThrow(/chunkSize/);
    expect(() => chunkDocument(document, { chunkSize: 256, overlap: 256 })).toThrow(/overlap/);
    expect(() => chunkDocument(
      { format: "txt", characterCount: 512, segments: [{ text: "x".repeat(512) }] },
      { chunkSize: 256, overlap: 0, maxChunks: 1 },
    )).toThrow(/safe processing limit/);
  });
});
