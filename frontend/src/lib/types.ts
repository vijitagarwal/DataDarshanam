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

export interface EvidenceItem {
  id: string;
  metric: string;
  label: string;
  value: number | string | null;
  category?: string;
  calculationType: string;
  context: string;
}

export interface EvidencePacket {
  generatedFrom: "deterministic_query_result";
  metric: string;
  dimensions: string[];
  facts: EvidenceItem[];
  supportedInterpretations: string[];
  unavailableInterpretations: string[];
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
  evidence?: EvidencePacket;
  answer?: ConversationalAnswer;
  answer_status?: ConversationalAnswer["status"];
  model_generated?: boolean;
}

export interface ConversationalAnswer {
  status: "answered" | "insufficient_data" | "unsupported" | "ambiguous";
  headline: string;
  explanation: string[];
  limitations: string[];
  model_generated: boolean;
  evidence: EvidenceItem[];
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
  summary?: string;
  summary_fallback?: boolean;
  model_generated?: boolean;
}

export interface DatasetColumnInfo {
  name: string;
  dtype: string;
  role: "numeric" | "categorical" | "date/time" | "text";
  sample_values?: DataValue[];
  missing?: number;
  missing_pct?: number;
  unique?: number;
  numeric_stats?: {
    min: number;
    max: number;
    mean: number;
    median: number;
    standard_deviation: number;
    q1: number;
    q3: number;
    zero_count: number;
    negative_count: number;
    outlier_count: number;
  };
  frequency?: Array<{ value: string; count: number }>;
  date_stats?: { earliest: string; latest: string; distinct_periods: number; granularity: string };
}

export interface DatasetProfile {
  rows: number;
  column_count: number;
  columns: DatasetColumnInfo[];
  numeric_columns: string[];
  categorical_columns: string[];
  date_columns: string[];
  sample_rows?: Record<string, DataValue>[];
  health_score?: number;
  duplicate_row_count?: number;
  empty_column_count?: number;
  quality_warnings?: Array<{ code: string; severity: "info" | "warning" | "critical"; message: string; column?: string }>;
}

export interface SchemaResponse {
  profile: DatasetProfile;
  suggested_questions: string[];
  dataset_id?: string;
  filename?: string;
  proactive_findings?: ProactiveFinding[];
}

export interface ProactiveFinding {
  id: string;
  title: string;
  explanation: string;
  severity: "info" | "attention" | "important";
  metric: string;
  evidence_ids: string[];
  evidence: Array<{ id: string; label: string; value: number | string; category?: string }>;
  limitations: string[];
  dimension?: string;
  aggregation: "sum" | "mean" | "count" | "max" | "min";
  finding_type: "top_category" | "category_difference";
  category?: string;
}

export interface UploadResponse extends SchemaResponse {
  dataset_id: string;
  filename: string;
  rows: number;
}

export interface DatasetSummary {
  id: string;
  original_filename: string;
  file_size: number;
  row_count: number;
  column_count: number;
  created_at: string;
  status: "uploading" | "ready" | "failed" | "deleting";
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
