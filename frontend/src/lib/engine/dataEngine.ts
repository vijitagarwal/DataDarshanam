/**
 * DataEngine — CSV data processing in TypeScript (replaces data_engine.py / pandas)
 * Handles: loading, profiling, filtering, aggregation, sorting, and suggestions.
 */

import { DatasetProfile, QueryResult, ParsedQuery, ColumnProfile, DataRow } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROW_COUNT_METRIC = "__row_count";
const MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TIME_COLUMNS = new Set(["year", "month", "month_name", "quarter"]);
const TIME_DIMS = new Set(["year", "month", "quarter"]);

// ---------------------------------------------------------------------------
// In-memory dataset store (per-workspace, per-process)
// Note: Vercel serverless functions may restart; this is acceptable for demos.
// ---------------------------------------------------------------------------

const _datasets: Map<string, DataRow[]> = new Map();
let _defaultData: DataRow[] | null = null;

// ---------------------------------------------------------------------------
// CSV Parser (no external dependency — handles quoted fields)
// ---------------------------------------------------------------------------

function parseCSV(text: string): DataRow[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  const rows: DataRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = splitCSVLine(line);
    const row: DataRow = {};
    headers.forEach((h, idx) => {
      const raw = values[idx] ?? "";
      row[h.trim()] = coerce(raw);
    });
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function coerce(raw: string): string | number | null {
  if (raw === "" || raw === "null" || raw === "NULL" || raw === "NA" || raw === "N/A") return null;
  const n = Number(raw);
  if (!isNaN(n) && raw.trim() !== "") return n;
  return raw;
}

// ---------------------------------------------------------------------------
// Date enrichment (adds year, month, month_name, quarter columns)
// ---------------------------------------------------------------------------

function enrichWithDates(rows: DataRow[]): DataRow[] {
  if (rows.length === 0) return rows;

  // Find date-like columns
  const sample = rows[0];
  const dateColumns: string[] = [];

  for (const col of Object.keys(sample)) {
    const val = sample[col];
    if (typeof val === "string" && /date|time|created|updated/i.test(col)) {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) dateColumns.push(col);
    }
  }

  if (dateColumns.length === 0) return rows;

  const primaryDate = dateColumns.includes("order_date") ? "order_date" : dateColumns[0];

  return rows.map(row => {
    const dateVal = row[primaryDate];
    if (typeof dateVal !== "string") return row;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return row;
    return {
      ...row,
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      month_name: MONTH_ORDER[d.getMonth()],
      quarter: Math.ceil((d.getMonth() + 1) / 3),
    };
  });
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export async function loadDefaultData(): Promise<DataRow[]> {
  if (_defaultData) return _defaultData;

  let text: string;

  try {
    // Server-side: read directly from public/ directory (faster, no HTTP round-trip)
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const filePath = join(process.cwd(), "public", "sales.csv");
    text = await readFile(filePath, "utf-8");
  } catch {
    // Fallback: HTTP fetch (for edge runtime / non-Node environments)
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";
    const res = await fetch(`${baseUrl}/sales.csv`);
    if (!res.ok) throw new Error("Failed to load default sales.csv");
    text = await res.text();
  }

  _defaultData = enrichWithDates(parseCSV(text));
  _datasets.set("default", _defaultData);
  return _defaultData;
}

export function getDataset(workspaceId: string): DataRow[] | null {
  return _datasets.get(workspaceId) ?? _datasets.get("default") ?? null;
}

export function setDataset(workspaceId: string, rows: DataRow[]): void {
  _datasets.set(workspaceId, enrichWithDates(rows));
}

export function loadFromCSVText(text: string): DataRow[] {
  return enrichWithDates(parseCSV(text));
}

// ---------------------------------------------------------------------------
// Column profiling
// ---------------------------------------------------------------------------

function inferRole(col: string, values: (string | number | null)[]): ColumnProfile["role"] {
  if (TIME_COLUMNS.has(col)) return "date/time";
  const nonNull = values.filter(v => v !== null);
  if (nonNull.length === 0) return "text";

  const numericCount = nonNull.filter(v => typeof v === "number").length;
  if (numericCount / nonNull.length >= 0.9) return "numeric";

  const unique = new Set(nonNull).size;
  if (unique <= 50) return "categorical";
  return "text";
}

export function getDatasetProfile(rows: DataRow[]): DatasetProfile {
  if (rows.length === 0) {
    return { rows: 0, column_count: 0, columns: [], numeric_columns: [], categorical_columns: [], date_columns: [], text_columns: [] };
  }

  const cols = Object.keys(rows[0]);
  const columns: ColumnProfile[] = cols.map(col => {
    const values = rows.map(r => r[col] as string | number | null);
    const nonNull = values.filter(v => v !== null && v !== undefined);
    const role = inferRole(col, values);
    const uniqueVals = [...new Set(nonNull.map(String))];
    const missing = values.length - nonNull.length;

    return {
      name: col,
      dtype: role === "numeric" ? "float64" : "object",
      role,
      unique: uniqueVals.length,
      missing,
      missing_pct: rows.length ? Math.round((missing / rows.length) * 1000) / 10 : 0,
      samples: uniqueVals.slice(0, 5),
    };
  });

  return {
    rows: rows.length,
    column_count: cols.length,
    columns,
    numeric_columns: columns.filter(c => c.role === "numeric").map(c => c.name),
    categorical_columns: columns.filter(c => c.role === "categorical").map(c => c.name),
    date_columns: columns.filter(c => c.role === "date/time").map(c => c.name),
    text_columns: columns.filter(c => c.role === "text").map(c => c.name),
  };
}

// ---------------------------------------------------------------------------
// Schema context for LLM
// ---------------------------------------------------------------------------

export function buildSchemaContext(rows: DataRow[]): string {
  const profile = getDatasetProfile(rows);
  const lines = [
    `DATASET PROFILE: ${profile.rows} rows, ${profile.column_count} columns.`,
    "Use ONLY the columns listed below. Do not invent fields.",
    "",
    "COLUMNS:",
  ];

  for (const col of profile.columns) {
    const sampleStr = col.samples.length ? ` Examples: ${col.samples.slice(0, 4).join(", ")}.` : "";
    lines.push(`- ${col.name} (${col.role}, ${col.dtype}, ${col.unique} unique, ${col.missing_pct}% missing).${sampleStr}`);
  }

  const metricHint = [...profile.numeric_columns, ROW_COUNT_METRIC].join(", ");
  const dimHint = [...profile.categorical_columns, ...profile.date_columns].join(", ") || "No categorical/date columns found";
  lines.push("", `Good metric candidates: ${metricHint}.`, `Good dimension/filter candidates: ${dimHint}.`,
    "For trends, prefer month_name/year/quarter when available; otherwise use a date/time column.");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Suggest questions
// ---------------------------------------------------------------------------

function pickMetric(profile: DatasetProfile): string {
  if (!profile.numeric_columns.length) return ROW_COUNT_METRIC;
  const tokens = ["revenue", "sales", "amount", "total", "profit", "price", "cost", "quantity", "rating", "value"];
  for (const token of tokens) {
    const col = profile.numeric_columns.find(c => c.toLowerCase().includes(token));
    if (col) return col;
  }
  return profile.numeric_columns[0];
}

function pickCategory(profile: DatasetProfile): string | null {
  return profile.categorical_columns[0] ?? null;
}

export function suggestQuestions(rows: DataRow[], limit = 5): string[] {
  const profile = getDatasetProfile(rows);
  const metric = pickMetric(profile);
  const category = pickCategory(profile);
  const hasMontName = "month_name" in (rows[0] || {});
  const dateDim = hasMontName ? "month_name" : profile.date_columns[0] ?? null;

  const questions: string[] = [];
  if (metric && category && metric !== ROW_COUNT_METRIC) {
    questions.push(`Show ${metric.replace(/_/g, " ")} by ${category.replace(/_/g, " ")}`);
    questions.push(`Top 5 ${category.replace(/_/g, " ")} by ${metric.replace(/_/g, " ")}`);
  }
  if (metric && dateDim && metric !== ROW_COUNT_METRIC) {
    questions.push(`Show ${metric.replace(/_/g, " ")} trend by ${dateDim.replace(/_/g, " ")}`);
  }
  if (category) questions.push(`Count records by ${category.replace(/_/g, " ")}`);
  if (metric && metric !== ROW_COUNT_METRIC) questions.push(`Summarize ${metric.replace(/_/g, " ")} performance`);

  const fallback = ["Show an overview of this dataset", "Create a dashboard summary"];
  for (const f of fallback) { if (!questions.includes(f)) questions.push(f); }

  return questions.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const OPS: Record<string, (a: unknown, b: unknown) => boolean> = {
  eq:  (a, b) => a == b,
  neq: (a, b) => a != b,
  ne:  (a, b) => a != b,
  gt:  (a, b) => (a as number) > (b as number),
  lt:  (a, b) => (a as number) < (b as number),
  gte: (a, b) => (a as number) >= (b as number),
  lte: (a, b) => (a as number) <= (b as number),
  in:  (a, b) => (Array.isArray(b) ? b : [b]).map(String).includes(String(a)),
};

function applyFilters(rows: DataRow[], filters: ParsedQuery["filters"]): { rows: DataRow[]; error?: string } {
  for (const f of filters) {
    const { field, op, value } = f;
    if (!(op in OPS)) return { rows, error: `Unsupported operator: ${op}` };
    const fn = OPS[op];
    rows = rows.filter(r => fn(r[field], value));
  }
  return { rows };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function groupBy(rows: DataRow[], dimensions: string[]): Map<string, DataRow[]> {
  const map = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = dimensions.map(d => String(row[d] ?? "")).join("|||");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  }
  return map;
}

function aggregate(
  rows: DataRow[],
  metric: string,
  dimensions: string[],
  aggregation: string
): { result: DataRow[]; error?: string } {
  if (metric === ROW_COUNT_METRIC) {
    if (dimensions.length === 0) return { result: [{ [metric]: rows.length }] };
    const groups = groupBy(rows, dimensions);
    const result: DataRow[] = [];
    groups.forEach((groupRows, key) => {
      const dimVals = key.split("|||");
      const row: DataRow = {};
      dimensions.forEach((d, i) => { row[d] = dimVals[i]; });
      row[metric] = groupRows.length;
      result.push(row);
    });
    return { result };
  }

  if (dimensions.length === 0) {
    // Single scalar
    const values = rows.map(r => r[metric] as number).filter(v => typeof v === "number");
    let scalar: number;
    if (aggregation === "sum") scalar = values.reduce((a, b) => a + b, 0);
    else if (aggregation === "mean") scalar = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    else if (aggregation === "count") scalar = values.length;
    else if (aggregation === "max") scalar = Math.max(...values);
    else if (aggregation === "min") scalar = Math.min(...values);
    else scalar = values.reduce((a, b) => a + b, 0);
    return { result: [{ [metric]: Math.round(scalar * 100) / 100 }] };
  }

  const groups = groupBy(rows, dimensions);
  const result: DataRow[] = [];

  groups.forEach((groupRows, key) => {
    const dimVals = key.split("|||");
    const row: DataRow = {};
    dimensions.forEach((d, i) => { row[d] = dimVals[i]; });

    const values = groupRows.map(r => r[metric] as number).filter(v => typeof v === "number");
    let agg: number;
    if (aggregation === "sum") agg = values.reduce((a, b) => a + b, 0);
    else if (aggregation === "mean") agg = values.reduce((a, b) => a + b, 0) / (values.length || 1);
    else if (aggregation === "count") agg = values.length;
    else if (aggregation === "max") agg = Math.max(...values);
    else if (aggregation === "min") agg = Math.min(...values);
    else agg = values.reduce((a, b) => a + b, 0);

    row[metric] = Math.round(agg * 100) / 100;
    result.push(row);
  });

  return { result };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

function sortResult(rows: DataRow[], metric: string, sortBy: string, sortOrder: string): DataRow[] {
  const asc = sortOrder !== "desc";

  if (rows.some(r => "month_name" in r)) {
    const monthIdx = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, i]));
    return [...rows].sort((a, b) => {
      const ai = monthIdx[String(a.month_name)] ?? 99;
      const bi = monthIdx[String(b.month_name)] ?? 99;
      return asc ? ai - bi : bi - ai;
    });
  }

  const col = (sortBy === "metric" || sortBy === metric) ? metric :
    (TIME_DIMS.has(sortBy) || rows[0]?.[sortBy] !== undefined) ? sortBy : metric;

  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === "number" && typeof bv === "number") return asc ? av - bv : bv - av;
    return asc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

function buildSummary(rows: DataRow[], metric: string, dimensions: string[]) {
  const values = rows.map(r => r[metric] as number).filter(v => typeof v === "number");
  const total = values.reduce((a, b) => a + b, 0);
  const average = total / (values.length || 1);
  const max_value = Math.max(...values);
  const maxRow = rows.find(r => r[metric] === max_value);

  let max_label: string | null = null;
  if (maxRow && dimensions.length > 0) {
    max_label = dimensions.length === 1
      ? String(maxRow[dimensions[0]])
      : dimensions.map(d => String(maxRow[d])).join(" | ");
  }

  return {
    total: Math.round(total * 100) / 100,
    average: Math.round(average * 100) / 100,
    max_value: Math.round(max_value * 100) / 100,
    max_label,
    row_count: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Main query runner
// ---------------------------------------------------------------------------

export function runQuery(parsed: ParsedQuery, rows: DataRow[]): QueryResult {
  if (parsed.error) {
    return { error: true, message: parsed.message, data: [], metric: "", dimensions: [], chart_type: "bar", title: "", x_label: "", y_label: "", summary: { total: 0, average: 0, max_value: 0, max_label: null, row_count: 0 } };
  }

  const {
    metric = "total_revenue",
    aggregation = "sum",
    dimensions = [],
    filters = [],
    chart_type = "bar",
    sort_by = "metric",
    sort_order = "desc",
    limit = 10,
    title = "Query Result",
    x_label = dimensions[0] ?? "",
    y_label = metric,
  } = parsed;

  // Apply filters
  const filterResult = applyFilters([...rows], filters);
  if (filterResult.error) return err(filterResult.error);
  let filtered = filterResult.rows;
  if (filtered.length === 0) return err("No data matched your filters. Try broadening your search criteria.");

  // Aggregate
  const aggResult = aggregate(filtered, metric, dimensions, aggregation);
  if (aggResult.error) return err(aggResult.error);
  let result = aggResult.result;
  if (result.length === 0) return err("No data matched your query after aggregation.");

  // Sort
  result = sortResult(result, metric, sort_by, sort_order);

  // Limit
  if (limit < 999) result = result.slice(0, limit);

  // Summary
  const summary = buildSummary(result, metric, dimensions);

  return { data: result, metric, dimensions, chart_type, title, x_label, y_label, summary };
}

function err(message: string): QueryResult {
  return { error: true, message, data: [], metric: "", dimensions: [], chart_type: "bar", title: "", x_label: "", y_label: "", summary: { total: 0, average: 0, max_value: 0, max_label: null, row_count: 0 } };
}

// ---------------------------------------------------------------------------
// Build overview dashboard queries
// ---------------------------------------------------------------------------

export function buildOverviewQueries(rows: DataRow[]): ParsedQuery[] {
  const profile = getDatasetProfile(rows);
  const metric = pickMetric(profile);
  const category = pickCategory(profile);
  const hasMonthName = "month_name" in (rows[0] || {});
  const timeDim = hasMonthName ? "month_name" : (profile.date_columns[0] ?? null);

  const queries: ParsedQuery[] = [];

  if (category) {
    const aggregation = metric === ROW_COUNT_METRIC ? "count" : "sum";
    const metricLabel = metric === ROW_COUNT_METRIC ? "Record Count" : metric.replace(/_/g, " ");
    queries.push({
      metric, aggregation, dimensions: [category], filters: [], chart_type: "bar",
      sort_by: "metric", sort_order: "desc", limit: 12,
      title: `${metricLabel} by ${category.replace(/_/g, " ")}`,
      x_label: category.replace(/_/g, " "), y_label: metricLabel,
    });
  }

  if (timeDim) {
    const aggregation = metric === ROW_COUNT_METRIC ? "count" : "sum";
    const metricLabel = metric === ROW_COUNT_METRIC ? "Record Count" : metric.replace(/_/g, " ");
    queries.push({
      metric, aggregation, dimensions: [timeDim], filters: [], chart_type: "line",
      sort_by: timeDim, sort_order: "asc", limit: 100,
      title: `${metricLabel} Trend`,
      x_label: timeDim.replace(/_/g, " "), y_label: metricLabel,
    });
  }

  if (category && metric !== ROW_COUNT_METRIC) {
    queries.push({
      metric, aggregation: "sum", dimensions: [category], filters: [], chart_type: "pie",
      sort_by: "metric", sort_order: "desc", limit: 8,
      title: `${metric.replace(/_/g, " ")} Share by ${category.replace(/_/g, " ")}`,
      x_label: category.replace(/_/g, " "), y_label: metric.replace(/_/g, " "),
    });
  }

  return queries.slice(0, 3);
}
