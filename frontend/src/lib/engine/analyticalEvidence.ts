import type { EvidenceItem, EvidencePacket } from "./types";
import type { QueryResult } from "./types";

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function generateAnalyticalEvidence(result: QueryResult): EvidencePacket {
  const rows = result.data ?? [];
  const metric = result.metric || "value";
  const dimensions = result.dimensions ?? [];
  const dimension = dimensions[0];
  const facts: EvidenceItem[] = [];
  const unavailable: string[] = [];

  const numericRows = rows
    .map((row) => {
      const value = row[metric];
      const category = dimension ? String(row[dimension] ?? "Unknown") : null;
      return isNumber(value) ? { category, value } : null;
    })
    .filter((row): row is { category: string | null; value: number } => row !== null);

  const fact = (
    calculationType: EvidenceItem["calculationType"],
    label: string,
    value: number | string | null,
    category?: string | null,
    context?: string,
  ): EvidenceItem => ({
    id: `F${facts.length + 1}`,
    metric,
    label,
    value,
    category: category ?? undefined,
    calculationType,
    context: context ?? `${numericRows.length} numeric result rows were available.`,
  });

  if (numericRows.length === 0) {
    unavailable.push("No numeric values were available for deterministic calculations.");
  } else {
    const values = numericRows.map((row) => row.value);
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = total / values.length;
    facts.push(fact("total", `Total ${metric.replace(/_/g, " ")}`, total, null));
    facts.push(fact("average", `Average ${metric.replace(/_/g, " ")}`, average, null));

    const ranked = [...numericRows].sort((a, b) => b.value - a.value);
    if (ranked[0]) facts.push(fact("highest", `Highest ${metric.replace(/_/g, " ")}`, ranked[0].value, ranked[0].category));
    if (ranked.length > 1) {
      const lowest = ranked[ranked.length - 1];
      facts.push(fact("lowest", `Lowest ${metric.replace(/_/g, " ")}`, lowest.value, lowest.category));
      if (total > 0) {
        facts.push(fact("share", `${ranked[0].category ?? "Leading category"} share of total`, ranked[0].value / total, ranked[0].category, "Share expressed as a proportion from 0 to 1."));
      } else {
        unavailable.push("Percentage contribution is unavailable because the total is not positive.");
      }
    }

    ranked.forEach((row, index) => {
      facts.push(fact("rank", `Rank ${index + 1}: ${row.category ?? metric}`, row.value, row.category ?? undefined));
    });

    if (ranked.length >= 2 && ranked[0].value !== ranked[1].value) {
      const difference = ranked[0].value - ranked[1].value;
      facts.push(fact("difference", `${ranked[0].category ?? "Leader"} minus ${ranked[1].category ?? "runner-up"}`, difference, ranked[0].category, "Difference between the highest and second-highest result."));
    }
  }

  const periodDimension = dimensions.find((name) => /year|month_name|month|quarter|date|period/i.test(name));
  if (periodDimension) {
    const periodRows = rows
      .map((row) => ({ period: String(row[periodDimension] ?? ""), value: row[metric] }))
      .filter((row): row is { period: string; value: number } => isNumber(row.value));
    const known = new Set(periodRows.map((row) => row.period));
    const monthOrder = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const ordered = [...periodRows].sort((a, b) => {
      const aMonth = monthOrder.findIndex((month) => String(a.period).toLowerCase().startsWith(month));
      const bMonth = monthOrder.findIndex((month) => String(b.period).toLowerCase().startsWith(month));
      if (aMonth >= 0 && bMonth >= 0) return aMonth - bMonth;
      return String(a.period).localeCompare(String(b.period), undefined, { numeric: true });
    });
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous.value !== 0) {
        const percentage = ((current.value - previous.value) / Math.abs(previous.value)) * 100;
        facts.push(fact("change", `${current.period} change from ${previous.period}`, percentage, current.period, "Percentage change from the immediately previous supported period."));
      }
    }
    const values = ordered.map((item) => item.value);
    if (values.length >= 2) {
      const first = values[0];
      const last = values[values.length - 1];
      const direction = last > first ? "increasing" : last < first ? "decreasing" : "flat";
      facts.push(fact("trend", `${periodDimension} trend`, direction, undefined, "Direction from first to last supported period."));
    }
    if (/month/.test(periodDimension) && known.size < 12 && known.size > 0) {
      facts.push(fact("missing_period", `${periodDimension} has missing supported periods`, "period data is incomplete", undefined, `${known.size} distinct periods were returned.`));
    }
  }

  if (numericRows.length >= 4) {
    const sortedValues = numericRows.map((row) => row.value).sort((a, b) => a - b);
    const midpoint = Math.floor(sortedValues.length / 2);
    const lower = sortedValues.slice(0, midpoint);
    const upper = sortedValues.slice(midpoint);
    const median = (values: number[]) => {
      const middle = Math.floor(values.length / 2);
      return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
    };
    const iqr = median(upper) - median(lower);
    if (iqr > 0) {
      numericRows.forEach((row) => {
        if (row.value > median(upper) + 1.5 * iqr || row.value < median(lower) - 1.5 * iqr) {
          facts.push(fact("outlier", `${row.category ?? metric} is an outlier`, row.value, row.category, "Value falls outside the 1.5-IQR fence derived from this result."));
        }
      });
    }
  }

  if (numericRows.length > 1) unavailable.push("Period-over-period changes require consecutive supported time periods.");

  return {
    generatedFrom: "deterministic_query_result",
    metric,
    dimensions,
    facts,
    supportedInterpretations: facts.map((item) => item.calculationType),
    unavailableInterpretations: [...new Set(unavailable)],
  };
}
