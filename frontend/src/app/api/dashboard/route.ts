import { NextRequest, NextResponse } from "next/server";
import { getDataset, loadDefaultData, buildOverviewQueries } from "@/lib/engine/dataEngine";
import { parseDashboardQuery } from "@/lib/engine/llmParser";
import { runQuery } from "@/lib/engine/dataEngine";
import { buildChart } from "@/lib/engine/chartBuilder";
import { ParsedQuery } from "@/lib/engine/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function getWorkspaceId(req: NextRequest): string {
  const id = req.headers.get("X-Workspace-ID") ?? "default";
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : "default";
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query: string = (body.query ?? "generate full dashboard overview").trim();

    const workspaceId = getWorkspaceId(req);
    let rows = getDataset(workspaceId);
    if (!rows) rows = await loadDefaultData();

    let dashboardQueries: ParsedQuery[] | null = await parseDashboardQuery(query, rows);

    if (!dashboardQueries || dashboardQueries.length === 0) {
      // Fallback overview
      dashboardQueries = buildOverviewQueries(rows) as ParsedQuery[];
      if (!dashboardQueries.length) {
        dashboardQueries = [
          { chart_type: "bar", metric: "total_revenue", aggregation: "sum", dimensions: ["category"], filters: [], sort_order: "desc", sort_by: "metric", limit: 5, title: "Top Categories by Revenue", x_label: "Category", y_label: "Total Revenue" },
          { chart_type: "line", metric: "total_revenue", aggregation: "sum", dimensions: ["month_name"], filters: [], sort_order: "asc", sort_by: "month_name", limit: 12, title: "Monthly Revenue Trend", x_label: "Month", y_label: "Total Revenue" },
          { chart_type: "pie", metric: "total_revenue", aggregation: "sum", dimensions: ["region"], filters: [], sort_order: "desc", sort_by: "metric", limit: 5, title: "Revenue Distribution by Region", x_label: "Region", y_label: "Total Revenue" },
        ];
      }
    }

    const charts = [];
    for (const p of dashboardQueries) {
      const result = runQuery(p, rows);
      if (!result.error) {
        const darkSpec = buildChart(result, true);
        const lightSpec = buildChart(result, false);
        charts.push({ parsed: p, result, plotly_spec: { dark: darkSpec, light: lightSpec } });
      }
    }

    return NextResponse.json({ success: true, query, charts });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Dashboard generation failed" }, { status: 500 });
  }
}
