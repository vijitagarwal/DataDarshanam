"use client";

import React from "react";
import { DashboardResponse } from "@/lib/types";
import { ChartView } from "./ChartView";
import { LayoutGrid } from "lucide-react";

interface DashboardViewProps {
  response: DashboardResponse;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ response }) => {
  const query = response.query;
  const charts = response.charts || [];

  return (
    <div className="w-full mb-8 animate-fadeIn">
      {/* User Query Bubble */}
      <div className="flex justify-end mb-4">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[80%] text-sm font-medium shadow-lg shadow-indigo-500/20">
          {query}
        </div>
      </div>

      {/* Dashboard Section Header */}
      <div className="glass-card p-3.5 mb-4 flex items-center justify-between border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-slate-900">
        <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
          <LayoutGrid className="w-5 h-5 text-indigo-400" />
          <span>Full Dataset Overview Dashboard</span>
        </div>
        <span className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 px-2.5 py-0.5 rounded-full font-medium">
          3-Chart Analysis
        </span>
      </div>

      {/* Grid of Mini Chart Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {charts.slice(0, 2).map((item, idx) => (
          <div key={idx} className="glass-card p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-indigo-500/10">
              <span className="text-xs font-bold text-slate-200 capitalize">
                {item.parsed?.title || item.result?.metric?.replace(/_/g, " ")}
              </span>
              <span className="text-[11px] font-semibold text-indigo-400">
                Total: {item.result?.summary?.total?.toLocaleString()}
              </span>
            </div>
            <ChartView result={item.result} plotlySpec={item.plotly_spec} />
          </div>
        ))}
      </div>

      {charts.length >= 3 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-indigo-500/10">
            <span className="text-xs font-bold text-slate-200 capitalize">
              {charts[2].parsed?.title || charts[2].result?.metric?.replace(/_/g, " ")}
            </span>
            <span className="text-[11px] font-semibold text-indigo-400">
              Top: {charts[2].result?.summary?.max_label || "—"} ({charts[2].result?.summary?.max_value?.toLocaleString()})
            </span>
          </div>
          <ChartView result={charts[2].result} plotlySpec={charts[2].plotly_spec} />
        </div>
      )}
    </div>
  );
};
