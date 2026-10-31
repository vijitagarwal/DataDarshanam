import { NextRequest, NextResponse } from "next/server";
import { DatasetSelectionError, resolveRequestDataset } from "@/lib/engine/datasetSelection";
import { parseQuery } from "@/lib/engine/llmParser";
import { runQuery } from "@/lib/engine/dataEngine";
import { buildChart } from "@/lib/engine/chartBuilder";
import { generateInsight } from "@/lib/engine/insightGen";
import { generateAnalyticalEvidence } from "@/lib/engine/analyticalEvidence";
import { validateConversationContext, resolveConversationReference } from "@/lib/conversationContext";
import { DATASET_ID_HEADER, DATASET_MODE_HEADER } from "@/lib/constants";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: true, message: "Request body must be valid JSON" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: true, message: "Request body must be a JSON object" }, { status: 400 });
    }

    const queryValue = (body as Record<string, unknown>).query;
    if (typeof queryValue !== "string") {
      return NextResponse.json({ error: true, message: "Query must be a string" }, { status: 400 });
    }
    const query = queryValue.trim();
    const previousContextValue = (body as Record<string, unknown>).previous_context;
    const previousContext = previousContextValue !== null &&
      typeof previousContextValue === "object" &&
      !Array.isArray(previousContextValue)
      ? previousContextValue as Record<string, unknown>
      : null;
    const datasetMode = req.headers.get(DATASET_MODE_HEADER) ?? "demo";
    const datasetId = datasetMode === "custom" ? req.headers.get(DATASET_ID_HEADER) : "demo";
    const conversationContext = previousContext
      ? validateConversationContext(previousContext, datasetId ?? "")
      : null;
    if (previousContext && !conversationContext) {
      return NextResponse.json({ error: true, message: "Conversation context is invalid for the selected dataset." }, { status: 400 });
    }
    if (!query) {
      return NextResponse.json({ error: true, message: "Query string cannot be empty" }, { status: 400 });
    }

    let rows;
    try {
      ({ rows } = await resolveRequestDataset(req));
    } catch (e) {
      if (e instanceof DatasetSelectionError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      }
      throw e;
    }
    const supportedColumns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
    const reference = conversationContext ? resolveConversationReference(query, conversationContext, supportedColumns) : {};
    if (reference.clarification) {
      return NextResponse.json({
        success: false, error: true, query, answer_status: "ambiguous",
        message: reference.clarification, insight: reference.clarification,
      });
    }

    // Parse query via LLM
    const parserContext = conversationContext?.turns.at(-1)?.result as unknown as Record<string, unknown> | null ?? null;
    let parsed = await parseQuery(reference.resolvedQuery ?? query, rows, parserContext);

    if (parsed.error) {
      const status = parsed.code === "AI_SERVICE_ERROR" ? 503 : 200;
      return NextResponse.json({
        success: false, error: true,
        query, parsed,
        message: parsed.message ?? "Unable to parse query",
        insight: parsed.message ?? "Unable to parse query",
        code: parsed.code,
      }, { status });
    }
    if (reference.temporalFilter && !parsed.error) {
      parsed = {
        ...parsed,
        filters: [
          ...parsed.filters.filter((filter) => filter.field !== reference.temporalFilter?.field),
          { field: reference.temporalFilter.field, op: "eq", value: reference.temporalFilter.year },
        ],
      };
    }

    // Run data query
    const result = runQuery(parsed, rows);

    if (result.error) {
      return NextResponse.json({
        success: false, error: true,
        query, parsed, result,
        message: result.message ?? "Error running query on dataset",
        insight: result.message ?? "Error running query on dataset",
      });
    }

    // Build Plotly specs + insight in parallel
    const [darkSpec, lightSpec, { insight, fallback }] = await Promise.all([
      Promise.resolve(buildChart(result, true)),
      Promise.resolve(buildChart(result, false)),
      generateInsight(query, result),
    ]);
    const evidence = generateAnalyticalEvidence(result);
    const answer = {
      status: evidence.facts.length ? "answered" as const : "insufficient_data" as const,
      headline: fallback ? "Computed result available" : insight.split("\n")[0],
      explanation: fallback ? [insight] : insight.split("\n").slice(1),
      limitations: evidence.unavailableInterpretations,
      model_generated: !fallback,
      evidence: evidence.facts,
    };

    return NextResponse.json({
      success: true, error: false,
      query, parsed, result, insight,
      answer,
      evidence,
      answer_status: answer.status,
      model_generated: answer.model_generated,
      fallback,
      used_context: previousContext !== null,
      plotly_spec: { dark: darkSpec, light: lightSpec },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Query execution failed" }, { status: 500 });
  }
}
