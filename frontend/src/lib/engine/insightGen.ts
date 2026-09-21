/**
 * Insight Generator — TypeScript port of insight_gen.py
 * Generates 2-3 sentence AI insights from query results using Groq.
 */

import Groq from "groq-sdk";
import { QueryResult } from "./types";

const SYSTEM_PROMPT = "Write exactly 2-3 sentences. No bullets or headers. Use exact numbers from the data. End with one actionable recommendation.";

function formatPrompt(userQuery: string, result: QueryResult): string {
  const summary = result.summary ?? {};
  const topRows = (result.data ?? []).slice(0, 3);
  const metric = result.metric ?? "value";

  const rowsStr = topRows
    .map(row => JSON.stringify(Object.fromEntries(Object.entries(row).slice(0, 4))))
    .join("; ");

  return (
    `Q: ${userQuery}\n` +
    `Metric: ${metric}. Total: ${summary.total}. Best: ${summary.max_label} (${summary.max_value}).\n` +
    `Top rows: ${rowsStr}`
  );
}

function fallbackInsight(result: QueryResult): string {
  const summary = result.summary ?? {};
  const maxLabel = summary.max_label ?? "N/A";
  const maxValue = summary.max_value ?? 0;
  const rawMetric = result.metric ?? "value";
  const metric = rawMetric.replace(/_/g, " ");
  const prefix = /revenue|price|cost|amount/.test(rawMetric) ? "$" : "";
  return `Top performer: ${maxLabel} with ${prefix}${maxValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} in ${metric}.`;
}

export async function generateInsight(userQuery: string, result: QueryResult): Promise<{ insight: string; fallback: boolean }> {
  if (result.error) {
    return { insight: result.message ?? "An unknown error occurred.", fallback: false };
  }
  if (!result.data?.length) {
    return { insight: "No data was returned for this query. Try adjusting your filters or broadening the date range.", fallback: false };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { insight: fallbackInsight(result), fallback: true };
  }

  try {
    const client = new Groq({ apiKey });
    const prompt = formatPrompt(userQuery, result);

    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    let insight = (response.choices[0].message.content ?? "").trim();
    if (insight.startsWith('"') && insight.endsWith('"')) {
      insight = insight.slice(1, -1).trim();
    }
    return { insight, fallback: false };
  } catch {
    return { insight: fallbackInsight(result), fallback: true };
  }
}
