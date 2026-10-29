"use client";

import React from "react";
import type { DashboardResponse } from "@/lib/types";
import { ChartView } from "./ChartView";
import { LayoutGrid } from "lucide-react";
import { KpiTiles } from "./KpiTiles";
import { ResultTable } from "./ResultTable";

interface DashboardViewProps {
  response: DashboardResponse;
  entryId?: string;
  isDark?: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ response, entryId, isDark = true }) => {
  const query = response.query;
  const charts = response.charts || [];

  return (
    <article id={entryId} className="ledger-result" aria-label={`Dataset overview: ${query}`}>
      {/* User Query Bubble */}
      <p className="ledger-question">{query}</p>

      {/* Dashboard Section Header */}
      <div className="ledger-figure-heading">
        <div>
          <p className="ledger-kicker"><LayoutGrid size={15} aria-hidden="true" /> Dataset overview</p>
          <h2 className="ledger-page-title">Overview</h2>
        </div>
        <span className="ledger-tag">{charts.length} charts returned</span>
      </div>

      <div className="ledger-dashboard-results">
        {charts.map((item, index) => (
          <section className="ledger-dashboard-chart" key={`${item.parsed.title}-${index}`}>
            <div className="ledger-figure-heading">
              <div>
                <p className="ledger-kicker">Chart {index + 1}</p>
                <h3>{item.parsed.title || item.result.metric.replace(/_/g, " ")}</h3>
              </div>
            </div>
            {item.result.data.length > 0 && (
              <>
                <p className="ledger-computed-label"><span aria-hidden="true">●</span> Figures computed from rows</p>
                <KpiTiles summary={item.result.summary} metric={item.result.metric} />
                <ChartView result={item.result} plotlySpec={item.plotly_spec} isDark={isDark} />
                <ResultTable rows={item.result.data} question={query} />
              </>
            )}
            {item.result.error && (
              <p className="ledger-message ledger-message-error" role="alert">
                {item.result.message || "This chart could not be computed."}
              </p>
            )}
            {!item.result.error && item.result.data.length === 0 && (
              <p className="ledger-empty-note">No result rows were returned for this chart.</p>
            )}
          </section>
        ))}
        {charts.length === 0 && <p className="ledger-empty-note">The dashboard service returned no charts.</p>}
      </div>
    </article>
  );
};
