export type DataValue = string | number | boolean | null;
export type PlotlyValue = DataValue | PlotlyValue[] | { [key: string]: PlotlyValue };

export interface FilterItem {
  field: string;
  operator: string;
  value: DataValue | DataValue[];
}

export interface QueryParsed {
  chart_type: "bar" | "line" | "pie" | "scatter" | "area" | "metric" | "table" | "error";
  metric: string;
  dimensions: string[];
  filters: FilterItem[];
  sort_order: "asc" | "desc";
  limit: number;
  title: string;
  x_label?: string;
  y_label?: string;
}

export interface QuerySummary {
  total?: number;
  average?: number;
  max_label?: string;
  max_value?: number;
  count?: number;
}

export interface QueryResultData {
  data: Record<string, DataValue>[];
  metric: string;
  dimensions: string[];
  summary: QuerySummary;
  error?: boolean;
  message?: string;
}

export interface PlotlyThemeSpec {
  data: Record<string, PlotlyValue>[];
  layout: Record<string, PlotlyValue>;
}

export interface QueryResponse {
  success: boolean;
  error?: boolean;
  query: string;
  parsed?: QueryParsed;
  result?: QueryResultData;
  insight: string;
  fallback?: boolean;
  used_context?: boolean;
  plotly_spec?: {
    dark: PlotlyThemeSpec;
    light: PlotlyThemeSpec;
  };
  message?: string;
}

export interface DashboardChartItem {
  parsed: QueryParsed;
  result: QueryResultData;
  plotly_spec: {
    dark: PlotlyThemeSpec;
    light: PlotlyThemeSpec;
  };
}

export interface DashboardResponse {
  success: boolean;
  query: string;
  charts: DashboardChartItem[];
}

export interface DatasetColumnInfo {
  name: string;
  dtype: string;
  role: "numeric" | "categorical" | "date/time" | "text";
  sample_values?: DataValue[];
}

export interface DatasetProfile {
  rows: number;
  column_count: number;
  columns: DatasetColumnInfo[];
  numeric_columns: string[];
  categorical_columns: string[];
  date_columns: string[];
  sample_rows?: Record<string, DataValue>[];
}

export interface SchemaResponse {
  profile: DatasetProfile;
  suggested_questions: string[];
}

export interface UploadResponse extends SchemaResponse {
  filename: string;
  rows: number;
}

export interface SavedChart {
  id: string;
  query: string;
  insight: string;
  summary?: QuerySummary;
  metric?: string;
  timestamp: number;
  response?: QueryResponse;
}

export interface ChatEntry {
  id: string;
  type: "query" | "dashboard";
  query: string;
  response?: QueryResponse;
  dashboardResponse?: DashboardResponse;
  isLoading?: boolean;
  chartTypeOverride?: string;
}


export interface MetricItem {
  label: string;
  key: string;
  format: "currency" | "number" | "percent";
}

export interface ChartConfig {
  xKey?: string;
  yKey?: string;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  groupKey?: string;
  metrics?: MetricItem[];
}
