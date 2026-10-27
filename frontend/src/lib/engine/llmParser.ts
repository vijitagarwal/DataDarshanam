/**
 * LLM Parser — TypeScript port of llm_parser.py
 * Uses Groq JS SDK with the configured production model.
 */

import Groq from "groq-sdk";
import { buildSchemaContext, getDatasetProfile } from "./dataEngine";
import { DataRow, ParsedQuery, ParsedQueryError, ParsedQueryResponse } from "./types";

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const BASE_SYSTEM_PROMPT = `You are a BI query parser for a live CSV dataset.
Return ONLY a raw JSON object. No markdown, no code fences, no prose.

{schema_context}

OUTPUT SCHEMA (all fields required):
{"metric":"<numeric_column>","aggregation":"sum|mean|count|max|min","dimensions":["<column>"],"filters":[],"chart_type":"bar|line|pie|scatter|heatmap","sort_by":"metric|<column>","sort_order":"asc|desc","limit":100,"title":"...","x_label":"...","y_label":"..."}

RULES:
- Use ONLY columns listed in the dataset profile.
- The metric must be a numeric column from the profile, or "__row_count" for record counts.
- Use aggregation:"sum" for totals, revenue, sales, amount, quantity, value, cost, or profit.
- Use aggregation:"mean" for average, rating, score, price, percent, or rate.
- Use metric:"__row_count" and aggregation:"count" when the user asks for number of records/orders/items.
- Use categorical/date columns as dimensions and filters.
- For filters, use exact sample values when shown in the profile.
- For top N, set limit:N and sort_order:"desc"; for bottom/lowest N, set sort_order:"asc".
- If the query asks for a trend/over time/monthly/yearly view, use a date/time dimension and chart_type:"line".
- If there is one categorical dimension, default to chart_type:"bar"; use "pie" only for share/distribution questions with few categories.
- Sort month_name chronologically with sort_by:"month_name", sort_order:"asc".
- Sort year/month/quarter/date dimensions ascending unless the user asks otherwise.
- If the query is unclear, choose the best metric and dimension from the profile and make a useful chart.
- If the user asks for a field that is not listed, return {"error":true,"message":"Field not available in this dataset. Try one of the visible columns."}`;

const CHITCHAT_EXACT = new Set([
  "hello", "hi", "hey", "awesome", "great", "thanks", "thank you",
  "cool", "nice", "ok", "okay", "wow", "yep", "nope", "sure", "bye",
  "good", "bad", "how are you", "what can you do", "who are you",
  "how are you?", "what's up", "whats up", "sup",
]);

const DATA_KEYWORDS = [
  "show", "tell", "what", "how", "revenue", "sales", "trend",
  "compare", "top", "best", "worst", "average", "total", "count",
  "region", "category", "product", "month", "year", "quarter",
  "rating", "discount", "payment", "chart", "graph", "breakdown",
  "analyze", "analysis", "dashboard", "report", "filter", "by",
  "insights", "insight", "generate", "whole", "full", "all",
  "give", "about", "data", "overview", "summary", "performance",
  "distribution", "share", "records", "rows", "columns",
];

function isChitchat(query: string): boolean {
  const q = query.toLowerCase().trim();
  if (CHITCHAT_EXACT.has(q)) return true;
  if (q.split(/\s+/).length < 3) return true;
  return !DATA_KEYWORDS.some(kw => q.includes(kw));
}

const AGGREGATIONS = new Set(["sum", "mean", "count", "max", "min"]);
const FILTER_OPERATORS = new Set(["eq", "neq", "ne", "gt", "lt", "gte", "lte", "in"]);
const CHART_TYPES = new Set(["bar", "line", "pie", "scatter", "heatmap"]);
const SORT_ORDERS = new Set(["asc", "desc"]);
const REQUIRED_FIELDS = [
  "metric", "aggregation", "dimensions", "filters", "chart_type",
  "sort_by", "sort_order", "limit", "title", "x_label", "y_label",
] as const;
const ALLOWED_FIELDS: Set<string> = new Set(REQUIRED_FIELDS);

function validationError(message: string, field?: string): ParsedQueryError {
  return { error: true, message, code: "INVALID_QUERY", ...(field ? { field } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFilterValue(value: unknown): value is string | number | string[] | number[] {
  if (typeof value === "string" || (typeof value === "number" && Number.isFinite(value))) return true;
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(item => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)));
}

export function validateParsedQuery(value: unknown, rows: DataRow[]): ParsedQueryResponse {
  if (!isRecord(value)) return validationError("The AI response must be a JSON object.");

  const unexpected = Object.keys(value).find(key => !ALLOWED_FIELDS.has(key));
  if (unexpected) return validationError(`Unexpected field "${unexpected}" in AI query output.`, unexpected);

  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) return validationError(`Missing required field "${field}" in AI query output.`, field);
  }

  const profile = getDatasetProfile(rows);
  const columns = new Set(profile.columns.map(column => column.name));
  const metric = value.metric;
  if (typeof metric !== "string" || (metric !== "__row_count" && !profile.numeric_columns.includes(metric))) {
    return validationError(`Metric "${String(metric)}" is not a numeric column in this dataset.`, "metric");
  }

  if (typeof value.aggregation !== "string" || !AGGREGATIONS.has(value.aggregation)) {
    return validationError(`Unsupported aggregation "${String(value.aggregation)}".`, "aggregation");
  }

  if (!Array.isArray(value.dimensions) || value.dimensions.some(d => typeof d !== "string" || !columns.has(d))) {
    const invalid = Array.isArray(value.dimensions)
      ? value.dimensions.find(d => typeof d !== "string" || !columns.has(d))
      : value.dimensions;
    return validationError(`Dimension "${String(invalid)}" is not a column in this dataset.`, "dimensions");
  }
  if (new Set(value.dimensions).size !== value.dimensions.length) {
    return validationError("Dimensions must not contain duplicates.", "dimensions");
  }

  if (!Array.isArray(value.filters)) return validationError("Filters must be an array.", "filters");
  for (const filter of value.filters) {
    if (!isRecord(filter)) return validationError("Each filter must be an object.", "filters");
    if (typeof filter.field !== "string" || !columns.has(filter.field)) {
      return validationError(`Filter field "${String(filter.field)}" is not a column in this dataset.`, "filters");
    }
    if (typeof filter.op !== "string" || !FILTER_OPERATORS.has(filter.op)) {
      return validationError(`Unsupported filter operator "${String(filter.op)}".`, "filters");
    }
    if (!isFilterValue(filter.value)) return validationError("Filter values must be non-empty strings, numbers, or arrays of those values.", "filters");
  }

  if (typeof value.chart_type !== "string" || !CHART_TYPES.has(value.chart_type)) {
    return validationError(`Unsupported chart type "${String(value.chart_type)}".`, "chart_type");
  }
  if (typeof value.sort_by !== "string" || (value.sort_by !== "metric" && !columns.has(value.sort_by))) {
    return validationError(`Sort field "${String(value.sort_by)}" is not available in this dataset.`, "sort_by");
  }
  if (typeof value.sort_order !== "string" || !SORT_ORDERS.has(value.sort_order)) {
    return validationError(`Sort order must be "asc" or "desc".`, "sort_order");
  }
  if (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100) {
    return validationError("Limit must be an integer between 1 and 100.", "limit");
  }
  for (const field of ["title", "x_label", "y_label"]) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      return validationError(`Field "${field}" must be a non-empty string.`, field);
    }
  }

  return {
    metric: value.metric as string,
    aggregation: value.aggregation as ParsedQuery["aggregation"],
    dimensions: value.dimensions as string[],
    filters: value.filters as ParsedQuery["filters"],
    chart_type: value.chart_type as ParsedQuery["chart_type"],
    sort_by: value.sort_by as string,
    sort_order: value.sort_order as ParsedQuery["sort_order"],
    limit: value.limit as number,
    title: value.title as string,
    x_label: value.x_label as string,
    y_label: value.y_label as string,
  };
}

export function parseModelOutput(text: string, rows: DataRow[]): ParsedQueryResponse {
  text = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return validationError("The AI returned no JSON object.");
  try {
    return validateParsedQuery(JSON.parse(match[0]), rows);
  } catch {
    return validationError("The AI returned malformed JSON.");
  }
}

function getClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY environment variable is not set.");
  return new Groq({ apiKey });
}

export async function parseQuery(
  userQuery: string,
  rows: DataRow[],
  previousContext?: Record<string, unknown> | null
): Promise<ParsedQueryResponse> {
  if (!userQuery?.trim()) {
    return { error: true, message: "Query is empty. Please ask a question about the dataset.", code: "EMPTY_QUERY" };
  }

  if (isChitchat(userQuery)) {
    return {
      error: true,
      message: "That does not look like a data question. Try asking things like 'show sales by region', 'monthly trend', or 'top categories'.",
      code: "NOT_DATA_QUERY",
    };
  }

  const schemaContext = buildSchemaContext(rows);
  const systemPrompt = BASE_SYSTEM_PROMPT.replace("{schema_context}", schemaContext);

  let contextBlock = "";
  if (previousContext && !previousContext.error) {
    const prevTitle = (previousContext.title as string) ?? "the previous query";
    const prevMetric = (previousContext.metric as string) ?? "";
    const prevDims = ((previousContext.dimensions as string[]) ?? []).join(", ");
    contextBlock = `\n\nConversation context: user previously asked "${prevTitle}". Previous metric: ${prevMetric}. Previous dimensions: ${prevDims || "none"}. Reuse filters/dimensions when the new query is ambiguous.`;
  }

  const userContent = userQuery.trim() + contextBlock;
  const client = getClient();

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  let raw: string;
  try {
    const response = await client.chat.completions.create({
      model: GROQ_MODEL,
      messages,
      temperature: 0.1,
      max_tokens: 500,
    });
    raw = response.choices[0].message.content ?? "";
  } catch (e) {
    return { error: true, message: `Failed to reach AI service: ${e}`, code: "AI_SERVICE_ERROR" };
  }

  try {
    const parsed = parseModelOutput(raw, rows);
    if (!parsed.error) return parsed;
    // Retry once for malformed JSON only. Semantic validation errors are final.
    if (parsed.code === "INVALID_QUERY" && !parsed.message.includes("no JSON object") && !parsed.message.includes("malformed JSON")) {
      return parsed;
    }
    try {
      const retryMessages: Groq.Chat.ChatCompletionMessageParam[] = [
        ...messages,
        { role: "assistant", content: raw },
        { role: "user", content: "RETRY: Output ONLY a raw JSON object starting with { and ending with }. No markdown, no prose." },
      ];
      const retryResp = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages: retryMessages,
        temperature: 0.0,
        max_tokens: 500,
      });
      const retryParsed = parseModelOutput(retryResp.choices[0].message.content ?? "", rows);
      return retryParsed;
    } catch {
      return { error: true, message: "The AI returned an unreadable response. Please try rephrasing your question.", code: "INVALID_QUERY" };
    }
  } catch {
    return { error: true, message: "The AI returned an unreadable response. Please try rephrasing your question.", code: "INVALID_QUERY" };
  }
}

export async function parseDashboardQuery(userQuery: string, rows: DataRow[]): Promise<ParsedQuery[] | null> {
  const triggers = new Set(["dashboard", "overview", "summary", "report"]);
  const words = new Set(userQuery.toLowerCase().split(/\s+/));
  const triggered = [...words].some(w => triggers.has(w)) || userQuery.toLowerCase().includes("full report");
  if (!triggered) return null;

  // Use dataEngine's buildOverviewQueries (imported dynamically to avoid circular)
  const { buildOverviewQueries } = await import("./dataEngine");
  return buildOverviewQueries(rows) as unknown as ParsedQuery[];
}
