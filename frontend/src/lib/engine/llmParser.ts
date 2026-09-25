/**
 * LLM Parser — TypeScript port of llm_parser.py
 * Uses Groq JS SDK with llama-3.3-70b-versatile
 */

import Groq from "groq-sdk";
import { ParsedQuery } from "./types";
import { buildSchemaContext } from "./dataEngine";
import { DataRow } from "./types";

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

function extractJSON(text: string): ParsedQuery {
  text = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object found in: ${text.slice(0, 200)}`);
  return JSON.parse(match[0]);
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
): Promise<ParsedQuery> {
  if (!userQuery?.trim()) {
    return { error: true, message: "Query is empty. Please ask a question about the dataset." } as unknown as ParsedQuery;
  }

  if (isChitchat(userQuery)) {
    return {
      error: true,
      message: "That does not look like a data question. Try asking things like 'show sales by region', 'monthly trend', or 'top categories'.",
    } as unknown as ParsedQuery;
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
      model: "llama3-70b-8192",
      messages,
      temperature: 0.1,
      max_tokens: 500,
    });
    raw = response.choices[0].message.content ?? "";
  } catch (e) {
    return { error: true, message: `Failed to reach AI service: ${e}` } as unknown as ParsedQuery;
  }

  try {
    return extractJSON(raw);
  } catch {
    // Retry once
    try {
      const retryMessages: Groq.Chat.ChatCompletionMessageParam[] = [
        ...messages,
        { role: "assistant", content: raw },
        { role: "user", content: "RETRY: Output ONLY a raw JSON object starting with { and ending with }. No markdown, no prose." },
      ];
      const retryResp = await client.chat.completions.create({
        model: "llama3-70b-8192",
        messages: retryMessages,
        temperature: 0.0,
        max_tokens: 500,
      });
      return extractJSON(retryResp.choices[0].message.content ?? "");
    } catch {
      return { error: true, message: "The AI returned an unreadable response. Please try rephrasing your question." } as unknown as ParsedQuery;
    }
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
