import { describe, expect, it } from "vitest";
import { CsvValidationError, decodeCsvBytes, parseCSV } from "./csv";

describe("CSV validation", () => {
  it("parses quoted commas, embedded newlines, and currency values", () => {
    expect(parseCSV('product,revenue,note\nLaptop,"$2,700","High\nvolume"\nPhone,"($1,250.50)",ok')).toEqual([
      { product: "Laptop", revenue: 2700, note: "High\nvolume" },
      { product: "Phone", revenue: -1250.5, note: "ok" },
    ]);
  });

  it("rejects empty or duplicate column names and inconsistent row widths", () => {
    for (const text of [
      "product,,revenue\nLaptop,one,2\n",
      "Product,product\nLaptop,1\n",
      "product,revenue\nLaptop\n",
      "product,revenue\nLaptop,1,extra\n",
    ]) {
      expect(() => parseCSV(text)).toThrowError(CsvValidationError);
    }
  });

  it("rejects malformed quoting and invalid UTF-8", () => {
    expect(() => parseCSV('product,note\nLaptop,"unfinished')).toThrowError(CsvValidationError);
    expect(() => decodeCsvBytes(new Uint8Array([0xff, 0xfe]))).toThrowError(/valid UTF-8/);
  });

  it("enforces row and column limits while parsing", () => {
    expect(() => parseCSV("product\nLaptop\nPhone\n", { maxRows: 1 }))
      .toThrowError(expect.objectContaining({ code: "CSV_LIMIT_EXCEEDED", status: 413 }));
    expect(() => parseCSV("product,revenue,region\nLaptop,1,North\n", { maxColumns: 2 }))
      .toThrowError(expect.objectContaining({ code: "CSV_LIMIT_EXCEEDED", status: 413 }));
    expect(() => parseCSV("product,region\nLaptop,North\nPhone,South\n", { maxCells: 3 }))
      .toThrowError(expect.objectContaining({ code: "CSV_LIMIT_EXCEEDED", status: 413 }));
  });
});
