"use client";

import React from "react";
import { Sparkles, AlertTriangle, Bot } from "lucide-react";

interface InsightCardProps {
  insight: string;
  fallback?: boolean;
  modelGenerated?: boolean;
}

export const InsightCard: React.FC<InsightCardProps> = ({ insight, fallback, modelGenerated = true }) => {
  if (!insight.trim()) return null;

  return (
    <section className="ledger-finding" aria-label={modelGenerated || fallback ? "Generated summary" : "Result note"}>
      <div className="ledger-finding-copy">
        <div className="ledger-finding-label">
          <Sparkles size={15} aria-hidden="true" />
          <span>Finding</span>
        </div>
        <h2>{insight}</h2>
      </div>
      {(modelGenerated || fallback) && (
        <span className="ledger-tag" title={fallback ? "A generated fallback summary, not a model response." : "A model-generated summary; figures are computed separately from query rows."}>
          {fallback ? <AlertTriangle size={13} aria-hidden="true" /> : <Bot size={13} aria-hidden="true" />}
          {fallback ? "Generated summary · fallback" : "Generated summary · model"}
        </span>
      )}
    </section>
  );
};
