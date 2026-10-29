"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { QueryResultData, PlotlyThemeSpec, PlotlyValue } from "@/lib/types";
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
  compact?: boolean;
  showControls?: boolean;
}

const PALETTE = ["#0b5d56", "#d98e04", "#4d817a", "#aa6e12", "#2f7770", "#8b6221"];

export const ChartView: React.FC<ChartViewProps> = ({
  result,
  plotlySpec,
  chartTypeOverride,
  onChartTypeChange,
  isDark = true,
  compact = false,
  showControls = true,
}) => {
  const [activeType, setActiveType] = useState<string>(chartTypeOverride || "auto");
  const [renderError, setRenderError] = useState<string | null>(null);
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
    { id: "auto", label: "Auto", icon: null },
    { id: "bar", label: "Bar", icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: "line", label: "Line", icon: <LineIcon className="w-3.5 h-3.5" /> },
    { id: "pie", label: "Pie", icon: <PieIcon className="w-3.5 h-3.5" /> },
    { id: "scatter", label: "Scatter", icon: <ScatterIcon className="w-3.5 h-3.5" /> },
    { id: "area", label: "Area", icon: <Layers className="w-3.5 h-3.5" /> },
  ];

  // Base Plotly data/layout from spec or fallback generator
  const { plotData, plotLayout } = useMemo(() => {
    const baseSpec = plotlySpec ? (isDark ? plotlySpec.dark : plotlySpec.light) : null;
    let data: PlotlyThemeSpec["data"] = baseSpec?.data ? [...baseSpec.data] : [];
    let layout: PlotlyThemeSpec["layout"] = baseSpec?.layout ? { ...baseSpec.layout } : {
      autosize: true,
      height: compact ? 240 : 340,
      margin: { t: 30, b: 72, l: 52, r: 16 },
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "Inter, sans-serif", color: isDark ? "#9bb0aa" : "#51635f" },
    };

    if (activeType !== "auto" && result?.data?.length > 0) {
      const dataRows = result.data;
      const metric = result.metric;
      const dimension = result.dimensions?.[0] || Object.keys(dataRows[0])[0];
      const xVals = dataRows.map((row) => row[dimension]);
      const yVals = dataRows.map((row) => row[metric]);

      if (activeType === "pie") {
        data = [{
          labels: xVals,
          values: yVals,
          type: "pie",
          hole: 0.35,
          marker: { colors: PALETTE },
          textinfo: "label+percent",
        }];
      } else if (activeType === "line" || activeType === "area") {
        data = [{
          x: xVals,
          y: yVals,
          type: "scatter",
          mode: activeType === "line" ? "lines+markers" : "lines",
          line: { color: "#0b5d56", width: 3 },
          marker: { size: 7, color: "#d98e04" },
          ...(activeType === "area" ? { fill: "tozeroy", fillcolor: "rgba(11, 93, 86, 0.16)" } : {}),
        }];
      } else if (activeType === "scatter") {
        const secondDimension = result.dimensions?.[1] || metric;
        data = [{
          x: xVals,
          y: dataRows.map((row) => row[secondDimension]),
          mode: "markers",
          type: "scatter",
          marker: { size: 10, color: "#0b5d56" },
        }];
      } else if (activeType === "bar") {
        data = [{
          x: xVals,
          y: yVals,
          type: "bar",
          marker: { color: xVals.map((_, index) => index === 0 ? "#d98e04" : "#0b5d56") },
        }];
      }
    }

    const existingTitle = layout.title;
    const title = existingTitle && typeof existingTitle === "object" && !Array.isArray(existingTitle)
      ? existingTitle
      : undefined;
    layout = {
      ...layout,
      autosize: true,
      height: compact ? 240 : 340,
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      margin: { t: 38, b: 76, l: 56, r: 18 },
      font: { family: "Inter, sans-serif", size: 11, color: isDark ? "#9bb0aa" : "#51635f" },
      xaxis: {
        ...(typeof layout.xaxis === "object" && layout.xaxis !== null ? layout.xaxis as Record<string, PlotlyValue> : {}),
        automargin: true,
        tickangle: -30,
      },
      yaxis: {
        ...(typeof layout.yaxis === "object" && layout.yaxis !== null ? layout.yaxis as Record<string, PlotlyValue> : {}),
        automargin: true,
      },
      ...(title ? {
        title: {
          ...title,
          font: { family: "Georgia, serif", size: 16, color: isDark ? "#e8f0ed" : "#13201e" },
        },
      } : {}),
    };
    return { plotData: data, plotLayout: layout };
  }, [activeType, compact, isDark, plotlySpec, result]);

  // Pure Plotly.js DOM rendering (100% bypasses react-plotly.js bundler issues)
  useEffect(() => {
    let isCancelled = false;
    const chartElement = chartContainerRef.current;

    const renderPlot = async () => {
      if (!chartElement) return;
      try {
        setRenderError(null);
        const PlotlyModule = await import("plotly.js-dist-min");
        const Plotly = PlotlyModule.default || PlotlyModule;
        if (!isCancelled) {
          await Plotly.react(chartElement, plotData, plotLayout, {
            responsive: true,
            displayModeBar: !compact,
            displaylogo: false,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
          });
        }
      } catch (err) {
        console.error("Plotly render error:", err);
        if (!isCancelled) {
          setRenderError("This chart could not be rendered. Try another chart type or rerun the question.");
        }
      }
    };

    renderPlot();

    return () => {
      isCancelled = true;
      if (chartElement) {
        import("plotly.js-dist-min").then((module) => {
          const Plotly = module.default || module;
          Plotly.purge(chartElement);
        }).catch((error: unknown) => console.error("Plotly cleanup error:", error));
      }
    };
  }, [compact, plotData, plotLayout]);

  return (
    <div className="w-full flex flex-col">
      {/* Chart Type Switcher Pills */}
      {showControls && <div className="ledger-chart-controls" role="group" aria-label="Chart type">
        {chartTypes.map((ct) => {
          const isActive = activeType === ct.id;
          return (
            <button
              key={ct.id}
              type="button"
              aria-pressed={isActive}
              aria-label={`${ct.label.replace("✨ ", "")} chart`}
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
      </div>}

      {/* Plotly Canvas Container */}
      <div className={`w-full relative ${compact ? "min-h-[240px]" : "min-h-[300px]"}`} role="region" aria-label={`${result.metric.replace(/_/g, " ")} chart`}>
        <div ref={chartContainerRef} className={`w-full ${compact ? "h-[240px]" : "h-[340px]"}`} />
      </div>
      {renderError && <p className="ledger-message ledger-message-error" role="alert">{renderError}</p>}
    </div>
  );
};
