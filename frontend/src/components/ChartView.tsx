"use client";

import React, { useState, useEffect, useRef } from "react";
import { QueryResultData, PlotlyThemeSpec } from "@/lib/types";
import { BarChart3, LineChart as LineIcon, PieChart as PieIcon, ScatterChart as ScatterIcon, Layers } from "lucide-react";

interface ChartViewProps {
  result: QueryResultData;
  plotlySpec?: {
    dark: PlotlyThemeSpec;
    light: PlotlyThemeSpec;
  };
  chartTypeOverride?: string;
  onChartTypeChange?: (newType: string) => void;
  isDark?: boolean;
}

const PALETTE = ["#6366F1", "#8B5CF6", "#EC4899", "#F59E0B", "#10B981", "#3B82F6"];

export const ChartView: React.FC<ChartViewProps> = ({
  result,
  plotlySpec,
  chartTypeOverride,
  onChartTypeChange,
  isDark = true,
}) => {
  const [activeType, setActiveType] = useState<string>(chartTypeOverride || "auto");
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chartTypeOverride) {
      setActiveType(chartTypeOverride);
    }
  }, [chartTypeOverride]);

  const handleTypeSelect = (type: string) => {
    setActiveType(type);
    if (onChartTypeChange) {
      onChartTypeChange(type);
    }
  };

  const chartTypes = [
    { id: "auto", label: "✨ Auto", icon: null },
    { id: "bar", label: "Bar", icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: "line", label: "Line", icon: <LineIcon className="w-3.5 h-3.5" /> },
    { id: "pie", label: "Pie", icon: <PieIcon className="w-3.5 h-3.5" /> },
    { id: "scatter", label: "Scatter", icon: <ScatterIcon className="w-3.5 h-3.5" /> },
    { id: "area", label: "Area", icon: <Layers className="w-3.5 h-3.5" /> },
  ];

  // Base Plotly data/layout from spec or fallback generator
  const baseSpec = plotlySpec ? (isDark ? plotlySpec.dark : plotlySpec.light) : null;

  let plotData: PlotlyThemeSpec["data"] = baseSpec?.data ? [...baseSpec.data] : [];
  let plotLayout: PlotlyThemeSpec["layout"] = baseSpec?.layout ? { ...baseSpec.layout } : {
    autosize: true,
    height: 380,
    margin: { t: 40, b: 50, l: 50, r: 20 },
    paper_bgcolor: isDark ? "#141B2D" : "#FFFFFF",
    plot_bgcolor: isDark ? "#141B2D" : "#FFFFFF",
    font: { family: "Inter, sans-serif", color: isDark ? "#F8FAFC" : "#0F172A" },
  };

  // Modify chart type dynamically if overriden
  if (activeType !== "auto" && result?.data?.length > 0) {
    const dataRows = result.data;
    const metric = result.metric;
    const dimension = result.dimensions?.[0] || Object.keys(dataRows[0])[0];
    const xVals = dataRows.map((r) => r[dimension]);
    const yVals = dataRows.map((r) => r[metric]);

    if (activeType === "pie") {
      plotData = [
        {
          labels: xVals,
          values: yVals,
          type: "pie",
          hole: 0.4,
          marker: { colors: PALETTE },
          textinfo: "label+percent",
        },
      ];
    } else if (activeType === "line") {
      plotData = [
        {
          x: xVals,
          y: yVals,
          type: "scatter",
          mode: "lines+markers",
          line: { color: "#6366F1", width: 3 },
          marker: { size: 6, color: "#8B5CF6" },
        },
      ];
    } else if (activeType === "area") {
      plotData = [
        {
          x: xVals,
          y: yVals,
          type: "scatter",
          mode: "lines",
          fill: "tozeroy",
          line: { color: "#8B5CF6", width: 2 },
          fillcolor: "rgba(139, 92, 246, 0.2)",
        },
      ];
    } else if (activeType === "scatter") {
      const dim2 = result.dimensions?.[1] || metric;
      const yScatter = dataRows.map((r) => r[dim2]);
      plotData = [
        {
          x: xVals,
          y: yScatter,
          mode: "markers",
          type: "scatter",
          marker: { size: 10, color: "#EC4899" },
        },
      ];
    } else if (activeType === "bar") {
      plotData = [
        {
          x: xVals,
          y: yVals,
          type: "bar",
          marker: { color: "#6366F1", cornerradius: 4 },
        },
      ];
    }
  }

  // Ensure dark background and responsiveness
  const existingTitle = plotLayout.title;
  const title = existingTitle && typeof existingTitle === "object" && !Array.isArray(existingTitle)
    ? existingTitle
    : undefined;
  plotLayout = {
    ...plotLayout,
    autosize: true,
    height: 380,
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    margin: { t: 40, b: 50, l: 50, r: 20 },
    font: { family: "Inter, sans-serif", color: isDark ? "#94A3B8" : "#475569" },
    ...(title ? {
      title: {
        ...title,
        font: { family: "Inter, sans-serif", size: 16, color: isDark ? "#F8FAFC" : "#0F172A" }
      }
    } : {})
  };

  // Pure Plotly.js DOM rendering (100% bypasses react-plotly.js bundler issues)
  useEffect(() => {
    let isCancelled = false;

    const renderPlot = async () => {
      if (!chartContainerRef.current) return;
      try {
        const PlotlyModule = await import("plotly.js-dist-min");
        const Plotly = PlotlyModule.default || PlotlyModule;
        if (!isCancelled && chartContainerRef.current) {
          Plotly.react(chartContainerRef.current, plotData, plotLayout, {
            responsive: true,
            displayModeBar: true,
            displaylogo: false,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
          });
        }
      } catch (err) {
        console.error("Plotly render error:", err);
      }
    };

    renderPlot();

    return () => {
      isCancelled = true;
    };
  }, [plotData, plotLayout]);

  return (
    <div className="w-full flex flex-col">
      {/* Chart Type Switcher Pills */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3 bg-slate-900/50 p-1.5 rounded-xl border border-indigo-500/10">
        {chartTypes.map((ct) => {
          const isActive = activeType === ct.id;
          return (
            <button
              key={ct.id}
              onClick={() => handleTypeSelect(ct.id)}
              className={`pill-chip flex items-center gap-1 text-xs font-semibold px-2.5 py-1 transition-all ${
                isActive ? "pill-chip-active shadow-lg shadow-indigo-500/25" : ""
              }`}
            >
              {ct.icon}
              <span>{ct.label}</span>
            </button>
          );
        })}
      </div>

      {/* Plotly Canvas Container */}
      <div className="w-full min-h-[380px] relative">
        <div ref={chartContainerRef} className="w-full h-full min-h-[380px]" />
      </div>
    </div>
  );
};
