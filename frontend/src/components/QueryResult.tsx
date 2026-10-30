"use client";

import React, { useState } from "react";
import { QueryResponse, SavedChart } from "@/lib/types";
import { KpiTiles } from "./KpiTiles";
import { ChartView } from "./ChartView";
import { InsightCard } from "./InsightCard";
import { FilterPills } from "./FilterPills";
import { ResultTable } from "./ResultTable";
import { Download, BookmarkCheck, Bookmark, Link2, RotateCw, PencilLine } from "lucide-react";
import { serializeCsvRows } from "@/lib/csvExport";

interface QueryResultProps {
  entryIndex: number;
  response: QueryResponse;
  onSaveChart?: (savedItem: SavedChart) => void;
  isSaved?: boolean;
  entryId?: string;
  onRetry?: (query: string) => void;
  onEdit?: (query: string) => void;
  isDark?: boolean;
}

export const QueryResult: React.FC<QueryResultProps> = ({
  entryIndex,
  response,
  onSaveChart,
  isSaved = false,
  entryId,
  onRetry,
  onEdit,
  isDark = true,
}) => {
  const [chartOverride, setChartOverride] = useState<string>("auto");

  const query = response.query;
  const result = response.result;
  const parsed = response.parsed;
  const insight = response.insight;
  const fallback = response.fallback;
  const usedContext = response.used_context;

  if (response.error || result?.error) {
    return (
      <article id={entryId} className="ledger-result" aria-label={`Query: ${query}`}>
        <p className="ledger-question">{query}</p>
        <div className="ledger-message ledger-message-error" role="alert">
          <strong>We couldn&apos;t answer this question.</strong>
          <p>{response.message || result?.message || "Please check the question and try again."}</p>
          <div className="ledger-actions">
            <button type="button" className="ledger-button ledger-button-primary" onClick={() => onRetry?.(query)}>
              <RotateCw size={15} aria-hidden="true" /> Retry
            </button>
            <button type="button" className="ledger-button" onClick={() => onEdit?.(query)}>
              <PencilLine size={15} aria-hidden="true" /> Edit question
            </button>
          </div>
        </div>
      </article>
    );
  }

  const summary = result?.summary || {};
  const metric = result?.metric || "value";
  const dataRows = result?.data || [];

  // Download CSV handler
  const handleDownloadCSV = () => {
    if (!dataRows || dataRows.length === 0) return;
    const keys = Object.keys(dataRows[0]);
    const csvContent = serializeCsvRows(keys, dataRows);
    const encodedUri = `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `query_${entryIndex}_${metric}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSave = () => {
    if (onSaveChart) {
      onSaveChart({
        id: `saved-${Date.now()}`,
        query,
        insight,
        summary,
        metric,
        timestamp: Date.now(),
        response,
      });
    }
  };

  return (
    <article id={entryId} className="ledger-result" aria-label={`Query: ${query}`}>
      <p className="ledger-question">
        {query}
        {usedContext && <span className="ledger-tag"><Link2 size={13} aria-hidden="true" /> Follow-up</span>}
      </p>
      {parsed?.filters && <FilterPills filters={parsed.filters} />}

      <InsightCard insight={insight} fallback={fallback} modelGenerated={dataRows.length > 0 && !fallback} />
      {dataRows.length > 0 && (
        <p className="ledger-computed-label"><span aria-hidden="true">●</span> Figures computed from rows</p>
      )}
      <KpiTiles summary={summary} metric={metric} />

      {result && dataRows.length > 0 && (
        <section className="ledger-figure" aria-label="Query chart and result table">
          <div className="ledger-figure-heading">
            <div>
              <p className="ledger-kicker">Chart</p>
              <h3>{parsed?.title || `${metric.replace(/_/g, " ")} by ${result.dimensions.join(", ")}`}</h3>
            </div>
          </div>
          <ChartView
            result={result}
            plotlySpec={response.plotly_spec}
            isDark={isDark}
            chartTypeOverride={chartOverride}
            onChartTypeChange={setChartOverride}
          />
          <ResultTable rows={dataRows} question={query} />
          <div className="ledger-actions ledger-result-actions">
            <button type="button" onClick={handleDownloadCSV} className="ledger-button">
              <Download size={15} aria-hidden="true" /> Download CSV
            </button>
            <button type="button" onClick={handleSave} disabled={isSaved} className="ledger-button ledger-button-primary">
              {isSaved ? <BookmarkCheck size={15} aria-hidden="true" /> : <Bookmark size={15} aria-hidden="true" />}
              {isSaved ? "Saved to Charts" : "Save chart"}
            </button>
          </div>
        </section>
      )}
    </article>
  );
};
