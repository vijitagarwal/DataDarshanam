export function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "");
  const safeText = typeof value === "string" && /^[\u0000-\u0020\uFEFF]*[=+\-@]/u.test(text)
    ? `'${text}`
    : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function serializeCsvRows(headers: string[], rows: Record<string, unknown>[]): string {
  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ].join("\n");
}
