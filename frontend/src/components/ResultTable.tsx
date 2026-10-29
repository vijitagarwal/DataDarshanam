"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Table } from "lucide-react";
import type { DataValue } from "@/lib/types";

interface ResultTableProps {
  rows: Record<string, DataValue>[];
  question: string;
}

export function ResultTable({ rows, question }: ResultTableProps) {
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;

  const columns = Object.keys(rows[0]);
  const visibleRows = showAll ? rows : rows.slice(0, 5);

  return (
    <>
      <div className="ledger-table-heading">
        <h3><Table size={16} aria-hidden="true" /> Result rows</h3>
        <span>{rows.length} {rows.length === 1 ? "row" : "rows"}</span>
      </div>
      <div className="ledger-table-scroll" role="region" aria-label="Query result table" tabIndex={0}>
        <table className="ledger-result-table">
          <caption className="sr-only">Rows returned for: {question}</caption>
          <thead>
            <tr>{columns.map((column) => <th key={column} scope="col">{column.replace(/_/g, " ")}</th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => <td key={column}>{String(row[column] ?? "—")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="ledger-text-button"
          aria-expanded={showAll}
        >
          {showAll ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
          {showAll ? "Show fewer rows" : `Show all ${rows.length} rows`}
        </button>
      )}
    </>
  );
}
