"use client";

import { Bookmark, ExternalLink, Trash2 } from "lucide-react";
import type { SavedChart } from "@/lib/types";
import { ChartView } from "./ChartView";

interface SavedChartsViewProps {
  charts: SavedChart[];
  onOpen: (chart: SavedChart) => void;
  onDelete: (chart: SavedChart) => void;
}

export function SavedChartsView({ charts, onOpen, onDelete }: SavedChartsViewProps) {
  return (
    <section className="ledger-screen" aria-labelledby="saved-charts-heading">
      <p className="ledger-kicker">Your workspace</p>
      <h1 id="saved-charts-heading" className="ledger-page-title">Saved charts</h1>
      <p className="ledger-lede">
        Keep useful views close while this page is open. Saved charts are held in memory and do not persist across browser sessions.
      </p>

      {charts.length === 0 ? (
        <div className="ledger-empty">
          <Bookmark aria-hidden="true" size={22} />
          <h2>No charts saved yet</h2>
          <p>Run a question in Analyze, then save its chart to see it here.</p>
        </div>
      ) : (
        <div className="ledger-chart-gallery">
          {charts.map((chart) => (
            <article className="ledger-gallery-card" key={chart.id}>
              <div className="ledger-gallery-preview">
                {chart.response?.result ? (
                  <ChartView
                    result={chart.response.result}
                    plotlySpec={chart.response.plotly_spec}
                    isDark={typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"}
                    compact
                    showControls={false}
                  />
                ) : (
                  <p className="ledger-muted">A chart preview is unavailable for this saved result.</p>
                )}
              </div>
              <div className="ledger-gallery-copy">
                <p className="ledger-kicker">{chart.metric?.replace(/_/g, " ") || "Saved result"}</p>
                <h2>{chart.response?.parsed?.title || chart.query}</h2>
                <p className="ledger-muted">{chart.query}</p>
                <p className="ledger-caption">
                  Saved {new Date(chart.timestamp).toLocaleString()} · In-memory only
                </p>
                <div className="ledger-actions">
                  <button type="button" className="ledger-button ledger-button-primary" onClick={() => onOpen(chart)}>
                    <ExternalLink size={15} aria-hidden="true" /> Open in Analyze
                  </button>
                  <button
                    type="button"
                    className="ledger-button ledger-button-danger"
                    onClick={() => onDelete(chart)}
                    aria-label={`Delete saved chart: ${chart.query}`}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
