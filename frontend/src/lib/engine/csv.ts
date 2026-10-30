import Papa from "papaparse";
import type { DataRow } from "./types";

export const MAX_CSV_ROWS = 250_000;
export const MAX_CSV_COLUMNS = 100;
export const MAX_CSV_CELLS = 1_000_000;
export const MAX_CSV_BYTES = 25 * 1024 * 1024;

export class CsvValidationError extends Error {
  constructor(
    public readonly code: "INVALID_CSV" | "CSV_LIMIT_EXCEEDED",
    message: string,
    public readonly status: 400 | 413,
  ) {
    super(message);
    this.name = "CsvValidationError";
  }
}

function coerce(raw: string): string | number | null {
  const value = raw.trim();
  if (!value || /^(null|na|n\/a)$/i.test(value)) return null;

  const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
    ? Number(value)
    : null;
  if (numeric !== null && Number.isFinite(numeric)) return numeric;

  const accounting = value.match(/^\(\s*([$€£¥₹]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)\s*\)$/u);
  const currency = value.match(/^([+-]?)\s*([$€£¥₹])\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)$/u);
  if (accounting || currency) {
    const amountText = (accounting?.[1] ?? currency?.[3] ?? "").replace(/[$€£¥₹,\s]/gu, "");
    const amount = Number(amountText);
    if (Number.isFinite(amount)) {
      if (accounting) return -Math.abs(amount);
      return currency?.[1] === "-" ? -amount : amount;
    }
  }

  return raw;
}

export function parseCSV(
  text: string,
  limits: { maxRows?: number; maxColumns?: number; maxCells?: number } = {},
): DataRow[] {
  const maxRows = limits.maxRows ?? MAX_CSV_ROWS;
  const maxColumns = limits.maxColumns ?? MAX_CSV_COLUMNS;
  const maxCells = limits.maxCells ?? MAX_CSV_CELLS;
  const source = text.replace(/^\uFEFF/, "");
  const rows: DataRow[] = [];
  let headers: string[] | null = null;
  let failure: CsvValidationError | null = null;

  Papa.parse<string[]>(source, {
    delimiter: ",",
    skipEmptyLines: "greedy",
    step(result, parser) {
      if (result.errors.length) {
        failure = new CsvValidationError("INVALID_CSV", "CSV contains malformed quoting or rows.", 400);
        parser.abort();
        return;
      }

      const fields = result.data;
      if (!headers) {
        headers = fields.map((field) => field.trim());
        if (headers.some((header) => !header)) {
          failure = new CsvValidationError("INVALID_CSV", "CSV column names cannot be empty.", 400);
        } else if (headers.length > maxColumns) {
          failure = new CsvValidationError(
            "CSV_LIMIT_EXCEEDED",
            `CSV file exceeds the ${maxColumns} column limit.`,
            413,
          );
        } else if (new Set(headers.map((header) => header.toLocaleLowerCase())).size !== headers.length) {
          failure = new CsvValidationError("INVALID_CSV", "CSV column names must be unique.", 400);
        }
        if (failure) parser.abort();
        return;
      }

      if (fields.length !== headers.length) {
        failure = new CsvValidationError("INVALID_CSV", "CSV rows must contain the same number of fields as the header.", 400);
        parser.abort();
        return;
      }
      if (rows.length >= maxRows) {
        failure = new CsvValidationError(
          "CSV_LIMIT_EXCEEDED",
          `CSV file exceeds the ${maxRows.toLocaleString()} row limit.`,
          413,
        );
        parser.abort();
        return;
      }
      if ((rows.length + 1) * headers.length > maxCells) {
        failure = new CsvValidationError(
          "CSV_LIMIT_EXCEEDED",
          `CSV file exceeds the ${maxCells.toLocaleString()} cell safety limit.`,
          413,
        );
        parser.abort();
        return;
      }

      const row: DataRow = {};
      headers.forEach((header, index) => {
        row[header] = coerce(fields[index]);
      });
      rows.push(row);
    },
  });

  if (failure) throw failure;
  return rows;
}

export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CsvValidationError("INVALID_CSV", "CSV must be valid UTF-8 text.", 400);
  }
}
