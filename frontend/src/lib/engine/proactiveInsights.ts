import type { DataRow } from "./types";

export interface ProactiveFinding {
  id: string;
  title: string;
  explanation: string;
  severity: "info" | "attention" | "important";
  metric: string;
  evidence_ids: string[];
  evidence: Array<{ id: string; label: string; value: number | string; category?: string }>;
  limitations: string[];
  dimension?: string;
  aggregation: "sum" | "mean" | "count" | "max" | "min";
  finding_type: "top_category" | "category_difference";
  category?: string;
}

export function generateProactiveInsights(rows: DataRow[], numericColumns: string[], categoricalColumns: string[]): ProactiveFinding[] {
  const findings: ProactiveFinding[] = [];
  for (const metric of numericColumns.slice(0, 3)) {
    const values = rows.map((row) => ({ category: String(categoricalColumns[0] ? row[categoricalColumns[0]] ?? "Unknown" : "Dataset"), value: row[metric] }))
      .filter((item): item is { category: string; value: number } => typeof item.value === "number" && Number.isFinite(item.value));
    if (!values.length) continue;
    const totals = new Map<string, number>();
    for (const item of values) totals.set(item.category, (totals.get(item.category) ?? 0) + item.value);
    const ranked = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = ranked[0];
    if (!top) continue;
    const evidence = [{ id: `PI-${metric}-1`, label: `${top[0]} ${metric.replace(/_/g, " ")}`, value: top[1], category: top[0] }];
    findings.push({
      id: evidence[0].id,
      title: `${top[0]} leads ${metric.replace(/_/g, " ")}`,
      explanation: `${top[0]} is the highest ${metric.replace(/_/g, " ")} group in the returned dataset.`,
      severity: "important",
      metric,
      evidence_ids: evidence.map((item) => item.id),
      evidence,
      limitations: ["Deterministic aggregate; narrative does not imply causation."],
      dimension: categoricalColumns[0],
      aggregation: "sum",
      finding_type: "top_category",
      category: String(top[0]),
    });
    if (ranked.length >= 2) {
      const difference = top[1] - ranked[1][1];
      const comparisonId = `PI-${metric}-2`;
      findings.push({
        id: comparisonId,
        title: `${top[0]} leads by ${difference.toLocaleString(undefined, { maximumFractionDigits: 6 })}`,
        explanation: `${top[0]} exceeds the next ranked group by a verified amount.`,
        severity: "attention",
        metric,
        evidence_ids: [comparisonId],
        evidence: [{ id: comparisonId, label: `${top[0]} minus ${ranked[1][0]}`, value: difference, category: top[0] }],
        limitations: ["Difference is calculated from the available rows only."],
        dimension: categoricalColumns[0],
        aggregation: "sum",
        finding_type: "category_difference",
        category: String(top[0]),
      });
    }
  }
  return findings.slice(0, 8);
}
