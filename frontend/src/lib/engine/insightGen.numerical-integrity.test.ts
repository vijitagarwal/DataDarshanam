import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("groq-sdk", () => ({
  default: class Groq {
    chat = { completions: { create: mocks.create } };
  },
}));

import { generateInsight } from "./insightGen";
import type { QueryResult } from "./types";

const result: QueryResult = {
  data: [{ category: "Books", revenue: 100 }, { category: "Games", revenue: 300 }],
  metric: "revenue",
  dimensions: ["category"],
  chart_type: "bar",
  title: "Revenue by category",
  x_label: "Category",
  y_label: "Revenue",
  summary: { total: 400, average: 200, max_value: 300, max_label: "Games", row_count: 2 },
};

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("numerical narrative integrity", () => {
  it("accepts valid references and renders server evidence values", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      headline: "Games leads revenue", explanation: "It has the highest verified result.", evidence_ids: ["F3"],
    }) } }] });
    const answer = await generateInsight("Which category leads?", result);
    expect(answer.fallback).toBe(false);
    expect(answer.insight).toContain("300 [F3]");
  });

  it.each([
    ["invented headline number", { headline: "Games leads by 999", explanation: "The result is clear.", evidence_ids: ["F3"] }],
    ["invented percentage", { headline: "Games leads", explanation: "It contributes 99 percent.", evidence_ids: ["F3"] }],
    ["unknown evidence", { headline: "Games leads", explanation: "The result is clear.", evidence_ids: ["F99"] }],
    ["duplicate evidence", { headline: "Games leads", explanation: "The result is clear.", evidence_ids: ["F3", "F3"] }],
  ])("falls back for %s", async (_name, payload) => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    mocks.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    await expect(generateInsight("Which category leads?", result)).resolves.toMatchObject({ fallback: true });
  });

  it("falls back for malformed provider output", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    mocks.create.mockResolvedValue({ choices: [{ message: { content: "{bad json" } }] });
    await expect(generateInsight("Which category leads?", result)).resolves.toMatchObject({ fallback: true });
  });

  it("falls back for provider failure", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key");
    mocks.create.mockRejectedValue(new Error("provider unavailable"));
    await expect(generateInsight("Which category leads?", result)).resolves.toMatchObject({ fallback: true });
  });
});
