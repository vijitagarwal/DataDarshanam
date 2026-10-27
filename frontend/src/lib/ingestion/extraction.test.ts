import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractDocument, ExtractionError } from "./extraction";

function createMinimalPdf(): Uint8Array {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    "4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 220 Td (PDF sample) Tj ET\nendstream\nendobj\n",
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

async function createMinimalDocx(): Promise<Uint8Array> {
  const zip = new JSZip();
  const files = [
    ["[Content_Types].xml", "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"],
    ["_rels/.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"],
    ["word/_rels/document.xml.rels", "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"></Relationships>"],
    ["word/document.xml", "<?xml version=\"1.0\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>DOCX sample</w:t></w:r></w:p></w:body></w:document>"],
  ];
  for (const [name, value] of files) zip.file(name, value);
  return zip.generateAsync({ type: "uint8array", compression: "STORE" });
}

describe("document extraction", () => {
  it("extracts valid PDF and DOCX samples", async () => {
    await expect(extractDocument(createMinimalPdf(), "pdf"))
      .resolves.toMatchObject({ format: "pdf", pageCount: 1 });
    await expect(extractDocument(await createMinimalDocx(), "docx"))
      .resolves.toMatchObject({ format: "docx", characterCount: 11 });
  });

  it("extracts UTF-8 text and Markdown deterministically", async () => {
    const text = await extractDocument(new TextEncoder().encode("Résumé\n\nQuarterly results"), "txt");
    const markdown = await extractDocument(new TextEncoder().encode("# Heading\n\nBody"), "md");

    expect(text.segments[0].text).toBe("Résumé\n\nQuarterly results");
    expect(markdown.segments[0].text).toBe("# Heading\n\nBody");
    expect(text.characterCount).toBe(25);
  });

  it("rejects empty, malformed, and unsupported content safely", async () => {
    await expect(extractDocument(new Uint8Array(), "txt")).rejects.toMatchObject({ code: "EMPTY_DOCUMENT" });
    await expect(extractDocument(new TextEncoder().encode("not a pdf"), "pdf"))
      .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await expect(extractDocument(new TextEncoder().encode("not a docx"), "docx"))
      .rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    await expect(extractDocument(new TextEncoder().encode("content"), "unsupported" as never))
      .rejects.toBeInstanceOf(ExtractionError);
  });

  it("validates signatures before parsing PDF and DOCX samples", async () => {
    await expect(extractDocument(new TextEncoder().encode("%PDF-1.7\n"), "pdf"))
      .rejects.toMatchObject({ code: "MALFORMED_DOCUMENT" });
    await expect(extractDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), "docx"))
      .rejects.toMatchObject({ code: "MALFORMED_DOCUMENT" });
  });

  it("rejects text that exceeds the extraction limit", async () => {
    await expect(extractDocument(new TextEncoder().encode("x".repeat(500_001)), "txt"))
      .rejects.toMatchObject({ code: "EXTRACTION_LIMIT" });
  });
});
