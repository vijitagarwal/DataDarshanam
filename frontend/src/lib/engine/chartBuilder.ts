/**
 * Chart Builder — TypeScript port of chart_builder.py
 * Generates Plotly JSON specs (dark/light) from query result data.
 * Does NOT depend on plotly Python — generates the spec object directly.
 */

import { QueryResult } from "./types";

// ---------------------------------------------------------------------------
// Design tokens
// ---------------------------------------------------------------------------

const PALETTE = ["#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#3B82F6"];

const DARK = {
  bg: "#0F172A",
  paper: "#0F172A",
  hover: "#1E293B",
  font: "#FFFFFF",
  grid: "rgba(255,255,255,0.08)",
};

const LIGHT = {
  bg: "#FFFFFF",
  paper: "#F8FAFC",
  hover: "#F1F5F9",
  font: "#0F172A",
  grid: "#E2E8F0",
};

const CONTINUOUS_SCALE = [
  [0.0, "#1E1B4B"], [0.33, "#6366F1"], [0.66, "#8B5CF6"], [1.0, "#EC4899"],
];

const CHART_HEIGHT = 420;
const MONTH_ORDER = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------------------
// Layout factory
// ---------------------------------------------------------------------------

function baseLayout(title: string, xLabel: string, yLabel: string, theme: typeof DARK) {
  return {
    height: CHART_HEIGHT,
    plot_bgcolor: theme.bg,
    paper_bgcolor: theme.paper,
    font: { family: "Inter, sans-serif", size: 13, color: theme.font },
    title: { text: title, font: { size: 18, color: theme.font, family: "Inter, sans-serif" }, x: 0.03 },
    margin: { t: 60, b: 40, l: 40, r: 20 },
    legend: { font: { color: theme.font }, bgcolor: "rgba(0,0,0,0)" },
    hoverlabel: { bgcolor: theme.hover, font: { color: theme.font } },
    xaxis: {
      title: { text: xLabel, font: { color: theme.font } },
      tickfont: { color: theme.font },
      gridcolor: theme.grid,
      showgrid: true,
      zeroline: false,
    },
    yaxis: {
      title: { text: yLabel, font: { color: theme.font } },
      tickfont: { color: theme.font },
      gridcolor: theme.grid,
      showgrid: true,
      zeroline: false,
    },
    dragmode: "zoom",
  };
}

// ---------------------------------------------------------------------------
// Bar chart
// ---------------------------------------------------------------------------

function buildBar(data: Record<string, unknown>[], x: string, y: string, result: QueryResult, theme: typeof DARK) {
  const xVals = data.map(r => r[x]);
  const yVals = data.map(r => r[y] as number);
  const nCats = new Set(xVals).size;
  const horizontal = nCats > 6;

  const colors = Array.from({ length: nCats }, (_, i) => PALETTE[i % PALETTE.length]);

  const maxVal = Math.max(...yVals);
  let textFmt: string;
  if (maxVal >= 1_000_000) textFmt = ".2s";
  else if (maxVal >= 1_000) textFmt = ",.0f";
  else if (maxVal < 10) textFmt = ".2f";
  else textFmt = ".1f";

  const layout = baseLayout(result.title, result.x_label, result.y_label, theme);

  if (horizontal) {
    return {
      data: [{
        type: "bar",
        orientation: "h",
        x: yVals,
        y: xVals,
        marker: {
          color: yVals,
          colorscale: CONTINUOUS_SCALE,
          showscale: false,
          line: { width: 0 },
        },
        text: yVals.map(v => v?.toLocaleString()),
        textposition: "outside",
        textfont: { color: theme.font, size: 11 },
        hovertemplate: `<b>%{y}</b><br>${y}: %{x:,.2f}<extra></extra>`,
      }],
      layout: {
        ...layout,
        xaxis: { ...layout.xaxis, title: { text: result.y_label, font: { color: theme.font } } },
        yaxis: {
          ...layout.yaxis,
          title: { text: result.x_label, font: { color: theme.font } },
          autorange: "reversed",
          gridcolor: theme.grid, showgrid: true, zeroline: false,
        },
        showlegend: false,
      },
    };
  }

  return {
    data: [{
      type: "bar",
      x: xVals,
      y: yVals,
      marker: { color: colors, line: { width: 0 } },
      text: yVals.map(v => (typeof v === "number" && maxVal >= 1000 ? v.toLocaleString() : String(v ?? ""))),
      textposition: "outside",
      textfont: { color: theme.font, size: 11 },
      hovertemplate: `<b>%{x}</b><br>${y}: %{y:,.2f}<extra></extra>`,
    }],
    layout: { ...layout, showlegend: result.dimensions.length > 1 },
  };
}

// ---------------------------------------------------------------------------
// Line chart
// ---------------------------------------------------------------------------

function buildLine(data: Record<string, unknown>[], x: string, y: string, result: QueryResult, theme: typeof DARK) {
  let sorted = [...data];
  if (x === "month_name") {
    const monthIdx = Object.fromEntries(MONTH_ORDER.map((m, i) => [m, i]));
    sorted = sorted.sort((a, b) => (monthIdx[String(a[x])] ?? 99) - (monthIdx[String(b[x])] ?? 99));
  }

  const hasSeries = result.dimensions.length > 1;
  const colorDim = hasSeries ? result.dimensions[1] : null;

  if (colorDim) {
    // Multi-series line
    const seriesMap = new Map<string, { xVals: unknown[]; yVals: number[] }>();
    for (const row of sorted) {
      const key = String(row[colorDim]);
      if (!seriesMap.has(key)) seriesMap.set(key, { xVals: [], yVals: [] });
      seriesMap.get(key)!.xVals.push(row[x]);
      seriesMap.get(key)!.yVals.push(row[y] as number);
    }
    const traces = [...seriesMap.entries()].map(([name, { xVals, yVals }], i) => ({
      type: "scatter",
      mode: "lines+markers",
      name,
      x: xVals,
      y: yVals,
      line: { color: PALETTE[i % PALETTE.length], width: 2.5, shape: "spline" },
      marker: { size: 7, line: { width: 1.5, color: theme.bg } },
      hovertemplate: `<b>%{x}</b><br>${y}: %{y:,.2f}<extra></extra>`,
    }));
    return { data: traces, layout: baseLayout(result.title, result.x_label, result.y_label, theme) };
  }

  return {
    data: [{
      type: "scatter",
      mode: "lines+markers",
      x: sorted.map(r => r[x]),
      y: sorted.map(r => r[y]),
      line: { color: PALETTE[0], width: 2.5, shape: "spline" },
      marker: { size: 7, line: { width: 1.5, color: theme.bg } },
      hovertemplate: `<b>%{x}</b><br>${y}: %{y:,.2f}<extra></extra>`,
    }],
    layout: baseLayout(result.title, result.x_label, result.y_label, theme),
  };
}

// ---------------------------------------------------------------------------
// Pie / Donut chart
// ---------------------------------------------------------------------------

function buildPie(data: Record<string, unknown>[], names: string, values: string, result: QueryResult, theme: typeof DARK) {
  const vals = data.map(r => r[values] as number);
  const maxVal = Math.max(...vals);
  const pull = vals.map(v => (v === maxVal ? 0.07 : 0));

  return {
    data: [{
      type: "pie",
      labels: data.map(r => r[names]),
      values: vals,
      pull,
      hole: 0.35,
      marker: { colors: PALETTE, line: { color: theme.paper, width: 2 } },
      textposition: "outside",
      textinfo: "label+percent",
      textfont: { color: theme.font, size: 12 },
      hovertemplate: `<b>%{label}</b><br>${values}: %{value:,.2f}<br>Share: %{percent}<extra></extra>`,
    }],
    layout: {
      height: CHART_HEIGHT,
      plot_bgcolor: theme.bg,
      paper_bgcolor: theme.paper,
      font: { family: "Inter, sans-serif", size: 13, color: theme.font },
      title: { text: result.title, font: { size: 18, color: theme.font }, x: 0.03 },
      margin: { t: 60, b: 20, l: 20, r: 20 },
      legend: { font: { color: theme.font }, bgcolor: "rgba(0,0,0,0)" },
      hoverlabel: { bgcolor: theme.hover, font: { color: theme.font } },
    },
  };
}

// ---------------------------------------------------------------------------
// Scatter chart
// ---------------------------------------------------------------------------

function buildScatter(data: Record<string, unknown>[], x: string, y: string, result: QueryResult, theme: typeof DARK) {
  return {
    data: [{
      type: "scatter",
      mode: "markers",
      x: data.map(r => r[x]),
      y: data.map(r => r[y]),
      marker: { size: 9, opacity: 0.85, color: PALETTE[0], line: { width: 1, color: theme.paper } },
      hovertemplate: `<b>${x}: %{x:,.2f}</b><br>${y}: %{y:,.2f}<extra></extra>`,
    }],
    layout: baseLayout(result.title, result.x_label, result.y_label, theme),
  };
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

function buildHeatmap(data: Record<string, unknown>[], result: QueryResult, theme: typeof DARK) {
  const dims = result.dimensions;
  const metric = result.metric;

  if (dims.length >= 2) {
    const [dimX, dimY] = dims;
    const xVals = [...new Set(data.map(r => String(r[dimX])))];
    const yVals = [...new Set(data.map(r => String(r[dimY])))];

    const zMatrix = yVals.map(yv =>
      xVals.map(xv => {
        const row = data.find(r => String(r[dimX]) === xv && String(r[dimY]) === yv);
        return row ? (row[metric] as number) : 0;
      })
    );

    return {
      data: [{
        type: "heatmap",
        x: xVals, y: yVals, z: zMatrix,
        colorscale: CONTINUOUS_SCALE,
        hovertemplate: `<b>${dimX}: %{x}</b><br>${dimY}: %{y}<br>${metric}: %{z:,.2f}<extra></extra>`,
        colorbar: { tickfont: { color: theme.font }, title: { text: metric, font: { color: theme.font } } },
      }],
      layout: {
        ...baseLayout(result.title, result.x_label, result.y_label, theme),
        xaxis: { ...baseLayout(result.title, result.x_label, result.y_label, theme).xaxis, showgrid: false },
        yaxis: { ...baseLayout(result.title, result.x_label, result.y_label, theme).yaxis, showgrid: false },
      },
    };
  }

  // Fallback to bar
  return buildBar(data, dims[0] ?? metric, metric, result, theme);
}

// ---------------------------------------------------------------------------
// Error figure
// ---------------------------------------------------------------------------

function errorFigure(message: string, theme: typeof DARK) {
  return {
    data: [],
    layout: {
      ...baseLayout("Error", "", "", theme),
      annotations: [{
        text: message, x: 0.5, y: 0.5,
        xref: "paper", yref: "paper",
        showarrow: false,
        font: { size: 15, color: "#EC4899" },
        align: "center",
      }],
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildChart(result: QueryResult, isDark = true): object {
  const theme = isDark ? DARK : LIGHT;

  if (result.error || !result.data?.length) {
    return errorFigure(result.message ?? "No data to display.", theme);
  }

  const { data, metric, dimensions, chart_type } = result;
  const xDim = dimensions[0] ?? metric;

  switch (chart_type) {
    case "line":
      return buildLine(data as Record<string, unknown>[], xDim, metric, result, theme);
    case "pie":
      return buildPie(data as Record<string, unknown>[], xDim, metric, result, theme);
    case "scatter": {
      const xCol = dimensions.length > 1 ? dimensions[1] : xDim;
      return buildScatter(data as Record<string, unknown>[], xCol, metric, result, theme);
    }
    case "heatmap":
      return buildHeatmap(data as Record<string, unknown>[], result, theme);
    default:
      return buildBar(data as Record<string, unknown>[], xDim, metric, result, theme);
  }
}
