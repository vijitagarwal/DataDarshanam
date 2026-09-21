import { NextRequest, NextResponse } from "next/server";
import { getDataset, loadDefaultData } from "@/lib/engine/dataEngine";
import { parseQuery } from "@/lib/engine/llmParser";
import { runQuery } from "@/lib/engine/dataEngine";
import { buildChart } from "@/lib/engine/chartBuilder";
import { generateInsight } from "@/lib/engine/insightGen";

export const runtime = "nodejs";
export const maxDuration = 60;

function getWorkspaceId(req: NextRequest): string {
  const id = req.headers.get("X-Workspace-ID") ?? "default";
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "default";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query: string = (body.query ?? "").trim();
    const previousContext = body.previous_context ?? null;

    if (!query) {
      return NextResponse.json({ error: true, message: "Query string cannot be empty" }, { status: 400 });
    }

    const workspaceId = getWorkspaceId(req);
    let rows = getDataset(workspaceId);
    if (!rows) rows = await loadDefaultData();

    // Parse query via LLM
    const parsed = await parseQuery(query, rows, previousContext);

    if (parsed.error) {
      return NextResponse.json({
        success: false, error: true,
        query, parsed,
        message: parsed.message ?? "Unable to parse query",
        insight: parsed.message ?? "Unable to parse query",
      });
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

    return NextResponse.json({
      success: true, error: false,
      query, parsed, result, insight,
      fallback,
      used_context: previousContext !== null,
      plotly_spec: { dark: darkSpec, light: lightSpec },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Query execution failed" }, { status: 500 });
  }
}
