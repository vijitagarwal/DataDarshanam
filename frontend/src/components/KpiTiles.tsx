"use client";

import React from "react";
import { QuerySummary } from "@/lib/types";

interface KpiTilesProps {
  summary: QuerySummary;
  metric: string;
}

function formatNumber(val: number | undefined): string {
  if (val === undefined || val === null || isNaN(val)) return "—";
  return val.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export const KpiTiles: React.FC<KpiTilesProps> = ({ summary, metric }) => {
  const totalStr = formatNumber(summary?.total);
  const avgStr = formatNumber(summary?.average);
  const topLabel = summary?.max_label || "—";
  const topValueStr = formatNumber(summary?.max_value);

  const metrics = [
    { label: "Total", value: totalStr, description: `Sum of ${metric.replace(/_/g, " ")}` },
    { label: "Average per group", value: avgStr, description: "Mean value" },
    { label: "Leading group", value: topLabel, description: topValueStr },
  ];

  return (
    <dl className="ledger-stat-row" aria-label="Figures computed from query rows">
      {metrics.map((item, index) => (
        <div className={index === 2 ? "ledger-stat-leading" : ""} key={item.label}>
          <dt>{item.label}</dt>
          <dd title={item.value}>{item.value}</dd>
          <span>{item.description}</span>
        </div>
      ))}
    </dl>
  );
};
