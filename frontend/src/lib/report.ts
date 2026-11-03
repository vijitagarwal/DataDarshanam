import { escapeCsvCell } from "./csvExport";

export interface PrintableReport {
  title: string;
  datasetName: string;
  generatedAt: Date;
  executiveSummary: string[];
  keyFindings: string[];
  evidence: Array<{ id: string; label: string; value: number | string | null }>;
  limitations: string[];
  tableHeaders: string[];
  tableRows: Record<string, unknown>[];
  chart?: { labels: string[]; values: number[] };
  truncatedRows?: number;
}

function escapeHtml(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  return text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function chartSvg(chart?: { labels: string[]; values: number[] }): string {
  if (!chart || chart.values.length === 0) return "";
  const max = Math.max(...chart.values.map((value) => Math.abs(value)), 1);
  const bars = chart.values.slice(0, 12).map((value, index) => {
    const width = 540 / Math.min(chart.values.length, 12);
    const height = Math.max(1, Math.abs(value) / max * 180);
    return `<rect x="${index * width + 8}" y="${188 - height}" width="${Math.max(1, width - 12)}" height="${height}" fill="#2563eb"><title>${escapeHtml(chart.labels[index] ?? "")}: ${escapeHtml(value)}</title></rect>`;
  }).join("");
  return `<h2>Chart</h2><svg role="img" aria-label="Query result chart" viewBox="0 0 560 200" width="100%" height="240">${bars}</svg>`;
}

export function printableReportHtml(report: PrintableReport): string {
  const evidenceRows = report.evidence.map((item) =>
    `<li><strong>${escapeHtml(item.id)}</strong> — ${escapeHtml(item.label)}: ${escapeHtml(item.value)}</li>`).join("");
  const summaryRows = report.executiveSummary.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const findingRows = report.keyFindings.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const limitationRows = report.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const tableHeader = report.tableHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const tableBody = report.tableRows.slice(0, 200).map((row) =>
    `<tr>${report.tableHeaders.map((header) => `<td>${escapeHtml(row[header])}</td>`).join("")}</tr>`).join("");
  const truncation = report.truncatedRows && report.truncatedRows > 0
    ? `<p class="notice"><strong>Report limited:</strong> This report contains the first 200 of ${escapeHtml(report.truncatedRows)} rows. The remaining rows are not shown.</p>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>
    <style>body{font-family:Arial,sans-serif;color:#172033;max-width:900px;margin:0 auto;padding:48px}header{border-bottom:2px solid #172033;padding-bottom:20px}h1{font-size:32px;margin:0}h2{font-size:18px;margin-top:28px}ul{padding-left:20px}li{margin:8px 0}.table-wrap{overflow-wrap:anywhere;overflow-x:auto}table{border-collapse:collapse;width:100%;margin-top:16px;font-size:11px;table-layout:auto}th,td{border:1px solid #ccd2dc;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#eef1f5}.meta,.footer{color:#667085;font-size:13px}.notice{border-left:4px solid #d97706;background:#fffbeb;padding:10px}.footer{margin-top:36px;border-top:1px solid #ccd2dc;padding-top:12px;font-size:12px}@media print{@page{margin:12mm 8mm}body{padding:0}.table-wrap{overflow:visible}table{font-size:8px}thead{display:table-header-group}tr{break-inside:avoid}svg{break-inside:avoid}}</style>
    </head><body><header><h1>${escapeHtml(report.title)}</h1><p class="meta">Dataset: ${escapeHtml(report.datasetName)} · Generated ${escapeHtml(report.generatedAt.toLocaleString())}</p></header>
    <h2>Executive summary</h2><ul>${summaryRows}</ul><h2>Key findings</h2><ul>${findingRows}</ul><h2>Evidence</h2><ul>${evidenceRows}</ul>
    <h2>Result table</h2>${truncation}<div class="table-wrap"><table><thead><tr>${tableHeader}</tr></thead><tbody>${tableBody}</tbody></table></div>${chartSvg(report.chart)}
    <h2>Limitations</h2><ul>${limitationRows}</ul><div class="footer">DataDarshanam analytical report · Page footer generated for print/PDF</div></body></html>`;
}

export function reportToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  return [headers.map(escapeCsvCell).join(","), ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","))].join("\n");
}

export function openReportPrintWindow(html: string, openWindow: (url: string, target: string, features: string) => Window | null = window.open.bind(window)): Window | null {
  const printWindow = openWindow("about:blank", "_blank", "popup=yes,width=1100,height=800");
  if (!printWindow) return null;
  try {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    return printWindow;
  } catch {
    printWindow.close();
    return null;
  }
}
