import { describe, expect, it, vi } from "vitest";
import { openReportPrintWindow, printableReportHtml, reportToCsv } from "./report";

describe("safe analytical reports", () => {
  it("creates a print-ready report without executing embedded HTML", () => {
    const html = printableReportHtml({
      title: "<Report>",
      datasetName: "sales.csv",
      generatedAt: new Date("2025-01-01T00:00:00Z"),
      executiveSummary: ["Verified result"],
      keyFindings: ["Revenue <script> 100"],
      evidence: [{ id: "F1", label: "Total", value: 100 }],
      limitations: ["Aggregate only"],
      tableHeaders: ["category", "revenue"],
      tableRows: [{ category: "A", revenue: 100 }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;Report&gt;");
    expect(html).toContain("&lt;script&gt;");
  });

  it("neutralizes spreadsheet formula cells in report CSV", () => {
    const csv = reportToCsv(["value"], [{ value: "=SUM(A1:A2)" }]);
    expect(csv).toBe('"value"\n"\'=SUM(A1:A2)"');
  });

  it("propagates dataset name and discloses report row truncation", () => {
    const html = printableReportHtml({
      title: "Revenue", datasetName: "northwind.csv", generatedAt: new Date(),
      executiveSummary: [], keyFindings: [], evidence: [], limitations: [],
      tableHeaders: ["value"], tableRows: [], truncatedRows: 250,
    });
    expect(html).toContain("northwind.csv");
    expect(html).toContain("first 200 of 250 rows");
  });

  it("opens, writes, and prints a report popup when allowed", () => {
    const popup = {
      document: { open: vi.fn(), write: vi.fn(), close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    expect(openReportPrintWindow("<html></html>", () => popup as unknown as Window)).toBe(popup);
    expect(popup.document.write).toHaveBeenCalledWith("<html></html>");
    expect(popup.print).toHaveBeenCalledOnce();
  });
});
