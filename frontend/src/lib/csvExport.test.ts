import { describe, expect, it } from "vitest";
import { escapeCsvCell, serializeCsvRows } from "./csvExport";

describe("CSV export cells", () => {
  it("neutralizes spreadsheet formulas in text fields", () => {
    expect(escapeCsvCell("=HYPERLINK(\"https://example.test\")")).toBe("\"'=HYPERLINK(\"\"https://example.test\"\")\"");
    expect(escapeCsvCell(" \t@SUM(1,2)")).toBe("\"' \t@SUM(1,2)\"");
  });

  it("keeps typed numeric values numeric and escapes quotes", () => {
    expect(escapeCsvCell(-2700)).toBe("\"-2700\"");
    expect(escapeCsvCell('A "quote"')).toBe("\"A \"\"quote\"\"\"");
  });

  it("exports the exact query result rows and column order", () => {
    expect(serializeCsvRows(["product", "revenue"], [
      { product: "Laptop", revenue: 2700 },
      { product: "Phone", revenue: 1750 },
      { product: "Tablet", revenue: 500 },
    ])).toBe([
      '"product","revenue"',
      '"Laptop","2700"',
      '"Phone","1750"',
      '"Tablet","500"',
    ].join("\n"));
  });
});
