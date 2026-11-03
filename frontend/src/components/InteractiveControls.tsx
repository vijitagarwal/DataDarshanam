"use client";

import React, { useState } from "react";
import type { DatasetProfile } from "@/lib/types";
import type { StructuredQueryRequest } from "@/lib/api";

interface InteractiveControlsProps {
  profile?: DatasetProfile;
  onExecute: (request: StructuredQueryRequest) => void;
}

export const InteractiveControls: React.FC<InteractiveControlsProps> = ({ profile, onExecute }) => {
  const [metric, setMetric] = useState("");
  const [dimension, setDimension] = useState("");
  const [aggregation, setAggregation] = useState("sum");

  if (!profile) return null;
  const metrics = profile.numeric_columns;
  const dimensions = [...profile.categorical_columns, ...profile.date_columns];
  return (
    <section className="mt-5" aria-label="Interactive analysis controls">
      <h3 className="ledger-subheading">Explore interactively</h3>
      <div className="grid gap-2">
        <label className="ledger-muted">
          Metric
          <select className="ledger-auth-input mt-1" value={metric} onChange={(event) => setMetric(event.target.value)}>
            <option value="">Select metric</option>
            {metrics.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="ledger-muted">
          Dimension
          <select className="ledger-auth-input mt-1" value={dimension} onChange={(event) => setDimension(event.target.value)}>
            <option value="">Select dimension</option>
            {dimensions.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}
          </select>
        </label>
        <label className="ledger-muted">
          Calculation
          <select className="ledger-auth-input mt-1" value={aggregation} onChange={(event) => setAggregation(event.target.value)}>
            <option value="sum">Sum</option>
            <option value="average">Average</option>
            <option value="maximum">Maximum</option>
            <option value="minimum">Minimum</option>
            <option value="count">Count</option>
          </select>
        </label>
        <button
          type="button"
          className="ledger-button ledger-button-primary"
          disabled={aggregation !== "count" ? (!metric || !dimension) : false}
          onClick={() => {
            const mappedAggregation = aggregation === "average" ? "mean" : aggregation === "maximum" ? "max" : aggregation === "minimum" ? "min" : aggregation as "sum" | "count";
            onExecute({
              metric: aggregation === "count" ? "__row_count" : metric,
              aggregation: mappedAggregation,
              dimensions: dimension ? [dimension] : [],
            });
          }}
        >
          Run analysis
        </button>
      </div>
    </section>
  );
};
