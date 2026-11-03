import { NextRequest, NextResponse } from "next/server";
import { DatasetSelectionError, resolveRequestDataset } from "@/lib/engine/datasetSelection";
import { parseQuery } from "@/lib/engine/llmParser";
import { runQuery } from "@/lib/engine/dataEngine";
import { buildChart } from "@/lib/engine/chartBuilder";
import { generateInsight } from "@/lib/engine/insightGen";
import { generateAnalyticalEvidence } from "@/lib/engine/analyticalEvidence";
import { validateConversationContext, resolveConversationReference } from "@/lib/conversationContext";
import { DATASET_ID_HEADER, DATASET_MODE_HEADER } from "@/lib/constants";
import { getDatasetProfile } from "@/lib/engine/dataEngine";
import { generateProactiveInsights } from "@/lib/engine/proactiveInsights";
import type { ParsedQuery } from "@/lib/engine/types";

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
    const structuredValue = (body as Record<string, unknown>).structured_query;
    if (typeof queryValue !== "string" && typeof structuredValue !== "object") {
      return NextResponse.json({ error: true, message: "Query must be a string" }, { status: 400 });
    }
    const query = typeof queryValue === "string" ? queryValue.trim() : "";
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
    if (!query && !structuredValue) {
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
    let parsed;
    if (structuredValue) {
      const request = structuredValue as Record<string, unknown>;
      const metric = typeof request.metric === "string" ? request.metric : "";
      const aggregation = request.aggregation;
      const requestedDimensions = Array.isArray(request.dimensions)
        ? request.dimensions.filter((value): value is string => typeof value === "string")
        : [];
      if (requestedDimensions.some((dimension) => !supportedColumns.includes(dimension))) {
        return NextResponse.json({ error: true, message: "Select supported dimensions for this dataset.", code: "INVALID_STRUCTURED_QUERY" }, { status: 400 });
      }
      const dimensions = requestedDimensions;
      const filters = Array.isArray(request.filters)
        ? request.filters.filter((filter): filter is Record<string, unknown> => typeof filter === "object" && filter !== null)
          .flatMap((filter) => {
            const field = filter.field;
            const op = filter.op;
            const value = filter.value;
            if (typeof field !== "string" || !supportedColumns.includes(field)) return [];
            if (!["eq", "neq", "gt", "lt", "gte", "lte"].includes(String(op))) return [];
            if (typeof value !== "string" && typeof value !== "number") return [];
            return [{ field, op, value }] as Array<{ field: string; op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte"; value: string | number }>;
          })
        : [];
      if (!["sum", "mean", "count", "max", "min"].includes(String(aggregation))) {
        return NextResponse.json({ error: true, message: "Unsupported aggregation.", code: "INVALID_STRUCTURED_QUERY" }, { status: 400 });
      }
      if (aggregation === "count") {
        if (metric && metric !== "__row_count" && !supportedColumns.includes(metric)) {
          return NextResponse.json({ error: true, message: "Count needs a compatible metric or row-count request.", code: "INVALID_STRUCTURED_QUERY" }, { status: 400 });
        }
      } else if (!metric || !supportedColumns.includes(metric)) {
        return NextResponse.json({ error: true, message: "Select a supported metric for this aggregation.", code: "INVALID_STRUCTURED_QUERY" }, { status: 400 });
      }
      const numericColumns = new Set(supportedColumns.filter((column) => rows.some((row) => typeof row[column] === "number")));
      if (aggregation !== "count" && !numericColumns.has(metric)) {
        return NextResponse.json({ error: true, message: "This aggregation only supports numeric columns.", code: "INCOMPATIBLE_AGGREGATION" }, { status: 400 });
      }
      const finding = request.finding;
      if (finding !== undefined) {
        if (typeof finding !== "object" || finding === null) {
          return NextResponse.json({ error: true, message: "The finding reference is invalid.", code: "INVALID_FINDING" }, { status: 400 });
        }
        const profile = getDatasetProfile(rows);
        const findingRef = finding as Record<string, unknown>;
        const validFindings = generateProactiveInsights(rows, profile.numeric_columns, profile.categorical_columns);
        const requestedFinding = validFindings.find((item) => item.id === findingRef.id);
        const evidenceIds = Array.isArray(findingRef.evidence_ids) ? findingRef.evidence_ids : [];
        if (!requestedFinding || evidenceIds.length === 0 ||
          evidenceIds.some((id) => !requestedFinding.evidence_ids.includes(String(id))) ||
          requestedFinding.metric !== metric ||
          requestedFinding.dimension !== dimensions[0] ||
          requestedFinding.aggregation !== aggregation ||
          requestedFinding.finding_type !== findingRef.finding_type ||
          requestedFinding.category !== findingRef.category) {
          return NextResponse.json({ error: true, message: "This finding is stale, unsupported, or ambiguous in the selected dataset.", code: "INVALID_FINDING" }, { status: 409 });
        }
      }
      const normalizedMetric = aggregation === "count" ? "__row_count" : metric;
      parsed = {
        metric: normalizedMetric,
        aggregation,
        dimensions,
        filters,
        chart_type: dimensions.length ? (rows.some((row) => typeof row[dimensions[0]] === "string" && !Number.isNaN(Date.parse(String(row[dimensions[0]])))) ? "line" : "bar") : "bar",
        sort_by: metric,
        sort_order: "desc",
        limit: 100,
        title: `${aggregation === "mean" ? "Average" : aggregation === "count" ? "Count" : aggregation} of ${metric.replace(/_/g, " ")}`,
        x_label: dimensions[0] ?? metric,
        y_label: metric,
      } as ParsedQuery;
    } else {
      parsed = await parseQuery(reference.resolvedQuery ?? query, rows, parserContext);
    }

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
      } as ParsedQuery;
    }

    // Run data query
    const result = runQuery(parsed as ParsedQuery, rows);

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
