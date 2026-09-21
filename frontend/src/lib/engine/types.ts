// Shared types for the DataDarshan engine layer

export interface ParsedQuery {
  metric: string;
  aggregation: "sum" | "mean" | "count" | "max" | "min";
  dimensions: string[];
  filters: FilterSpec[];
  chart_type: "bar" | "line" | "pie" | "scatter" | "heatmap";
  sort_by: string;
  sort_order: "asc" | "desc";
  limit: number;
  title: string;
  x_label: string;
  y_label: string;
  error?: boolean;
  message?: string;
}

export interface FilterSpec {
  field: string;
  op: "eq" | "neq" | "ne" | "gt" | "lt" | "gte" | "lte" | "in";
  value: string | number | string[] | number[];
}

export interface QueryResultSummary {
  total: number;
  average: number;
  max_value: number;
  max_label: string | null;
  row_count: number;
}

export interface QueryResult {
  data: Record<string, unknown>[];
  metric: string;
  dimensions: string[];
  chart_type: string;
  title: string;
  x_label: string;
  y_label: string;
  summary: QueryResultSummary;
  error?: boolean;
  message?: string;
}

export interface ColumnProfile {
  name: string;
  dtype: string;
  role: "numeric" | "categorical" | "date/time" | "text";
  unique: number;
  missing: number;
  missing_pct: number;
  samples: string[];
}

export interface DatasetProfile {
  rows: number;
  column_count: number;
  columns: ColumnProfile[];
  numeric_columns: string[];
  categorical_columns: string[];
  date_columns: string[];
  text_columns: string[];
}

export interface DataRow {
  [key: string]: string | number | boolean | null | undefined;
}
