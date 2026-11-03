import type { ColumnProfile, DataRow, DatasetProfile } from "./types";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quartile(values: number[], upper: boolean): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const half = upper ? sorted.slice(sorted.length % 2 ? middle + 1 : middle) : sorted.slice(0, middle);
  return median(half);
}

function frequency(values: unknown[], limit = 8): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function detectedGranularity(values: string[]): string {
  const timestamps = values.map((value) => new Date(value).getTime()).filter(Number.isFinite);
  if (timestamps.length < 2) return "unknown";
  const days = timestamps.map((value, index) => index ? Math.abs(value - timestamps[index - 1]) / 86_400_000 : 0).filter(Boolean);
  if (!days.length) return "unknown";
  const average = days.reduce((sum, value) => sum + value, 0) / days.length;
  if (average <= 1.4) return "daily";
  if (average <= 8) return "weekly";
  if (average <= 31.5) return "monthly";
  if (average <= 95) return "quarterly";
  return "yearly";
}

export function enrichDatasetProfile(profile: DatasetProfile, rows: DataRow[], fileSize?: number): DatasetProfile {
  const warnings: DatasetProfile["quality_warnings"] = [];
  const uniqueRows = new Set<string>();
  for (const row of rows) {
    const serialisedRow = JSON.stringify(Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))));
    uniqueRows.add(serialisedRow);
  }
  const duplicateRowCount = rows.length - uniqueRows.size;
  if (duplicateRowCount > 0) {
    warnings.push({
      code: "duplicate_rows",
      severity: duplicateRowCount / Math.max(rows.length, 1) > 0.05 ? "warning" : "info",
      message: `${duplicateRowCount.toLocaleString()} duplicate row${duplicateRowCount === 1 ? "" : "s"} detected.`,
    });
  }

  const columns = profile.columns.map((column): ColumnProfile => {
    const rawValues = rows.map((row) => row[column.name]);
    const missing = rawValues.filter((value) => value === null || value === undefined || value === "").length;
    const present = rawValues.filter((value) => value !== null && value !== undefined && value !== "");
    let numericStats = column.numeric_stats;
    let dateStats = column.date_stats;
    let frequencies = column.frequency;

    if (column.role === "numeric" || column.role === "date/time") {
      if (column.role === "numeric") {
        const values = present.map(Number).filter(Number.isFinite);
        if (values.length) {
          const q1 = quartile(values, false);
          const q3 = quartile(values, true);
          const iqr = q3 - q1;
          const outlierCount = values.filter((value) => value < q1 - 1.5 * iqr || value > q3 + 1.5 * iqr).length;
          const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
          numericStats = {
            min: values.reduce((minimum, value) => Math.min(minimum, value), Infinity),
            max: values.reduce((maximum, value) => Math.max(maximum, value), -Infinity),
            mean,
            median: median(values),
            standard_deviation: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length),
            q1,
            q3,
            zero_count: values.filter((value) => value === 0).length,
            negative_count: values.filter((value) => value < 0).length,
            outlier_count: outlierCount,
          };
        }
      } else {
        const dates = present.map(String).map((value) => ({ value, timestamp: new Date(value).getTime() })).filter((item) => Number.isFinite(item.timestamp));
        if (dates.length) {
          const timestamps = dates.map((item) => item.timestamp);
          dateStats = {
            earliest: new Date(timestamps.reduce((minimum, value) => Math.min(minimum, value), Infinity)).toISOString(),
            latest: new Date(timestamps.reduce((maximum, value) => Math.max(maximum, value), -Infinity)).toISOString(),
            distinct_periods: new Set(dates.map((item) => item.value)).size,
            granularity: detectedGranularity(dates.map((item) => item.value)),
          };
        }
      }
    } else {
      frequencies = frequency(present);
      if (present.length && frequencies.length / present.length > 0.8) {
        warnings.push({
          code: "high_cardinality",
          severity: "info",
          message: `${column.name} has high category variety.`,
          column: column.name,
        });
      }
    }

    if (missing > 0) {
      const missingPct = missing / Math.max(rows.length, 1);
      warnings.push({
        code: "missing_values",
        severity: missingPct >= 0.2 ? "critical" : "warning",
        message: `${column.name} has ${missing.toLocaleString()} missing values (${Math.round(missingPct * 100)}%).`,
        column: column.name,
      });
    }
    if (present.length === 0) {
      warnings.push({ code: "empty_column", severity: "critical", message: `${column.name} contains no usable values.`, column: column.name });
    }
    return { ...column, numeric_stats: numericStats, frequency: frequencies, date_stats: dateStats };
  });

  const missingScore = columns.reduce((penalty, column) => penalty + column.missing_pct, 0) / Math.max(columns.length, 1);
  const criticalCount = warnings.filter((warning) => warning.severity === "critical").length;
  const warningCount = warnings.filter((warning) => warning.severity === "warning").length;
  const healthScore = Math.max(0, Math.round(100 - missingScore * 0.5 - duplicateRowCount / Math.max(rows.length, 1) * 30 - criticalCount * 10 - warningCount * 3));

  return {
    ...profile,
    columns,
    file_size: fileSize,
    duplicate_row_count: duplicateRowCount,
    empty_column_count: columns.filter((column) => column.missing === rows.length).length,
    health_score: healthScore,
    quality_warnings: warnings,
  };
}
