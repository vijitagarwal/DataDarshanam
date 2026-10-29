import { describe, expect, it, vi } from "vitest";
import { generateInsight } from "./insightGen";
import type { QueryResult } from "./types";

const result: QueryResult = {
  data: [{ category: "Beauty", revenue: 5550625 }],
  metric: "revenue",
  dimensions: ["category"],
  chart_type: "bar",
  title: "Revenue by category",
  x_label: "Category",
  y_label: "Revenue",
  summary: { total: 5550625, average: 5550625, max_value: 5550625, max_label: "Beauty", row_count: 1 },
};

describe("deterministic insight fallback", () => {
  it("returns a useful insight without a Groq API key", async () => {
    vi.stubEnv("GROQ_API_KEY", "");

    await expect(generateInsight("Show revenue by category", result)).resolves.toEqual({
      insight: "Top performer: Beauty with 5,550,625 in revenue.",
      fallback: true,
    });

    vi.unstubAllEnvs();
  });
});
