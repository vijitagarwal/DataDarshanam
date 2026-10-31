import { describe, expect, it } from "vitest";
import { resolveConversationReference, validateConversationContext } from "./conversationContext";

const evidence = [
  { id: "F1", metric: "revenue", label: "Rank 1: Games", value: 300, category: "Games", calculationType: "rank", context: "Result row" },
  { id: "F2", metric: "revenue", label: "Rank 2: Books", value: 100, category: "Books", calculationType: "rank", context: "Result row" },
] as const;

describe("bounded conversational context", () => {
  it("preserves three ordered turns for the selected dataset", () => {
    const envelope = validateConversationContext({
      dataset_id: "dataset-a",
      turns: [1, 2, 3].map((number) => ({
        question: `Question ${number}`,
        result: { title: `Result ${number}`, metric: "revenue", dimensions: ["category"], evidence: [...evidence] },
      })),
    }, "dataset-a");
    expect(envelope?.turns.map((turn) => turn.question)).toEqual(["Question 1", "Question 2", "Question 3"]);
  });

  it("rejects non-finite or invalid evidence references", () => {
    expect(validateConversationContext({
      dataset_id: "dataset-a",
      turns: [{ question: "x", result: { title: "x", metric: "revenue", dimensions: [], evidence: [{ ...evidence[0], value: Infinity }] } }],
    }, "dataset-a")).toBeNull();
    expect(validateConversationContext({
      dataset_id: "dataset-a",
      turns: [{ question: "x", result: { title: "x", metric: "revenue", dimensions: [], evidence: [{ ...evidence[0], calculationType: "bogus" }] } }],
    }, "dataset-a")).toBeNull();
  });

  it("rejects oversized and cross-dataset context", () => {
    expect(validateConversationContext({ dataset_id: "dataset-b", turns: [] }, "dataset-a")).toBeNull();
    const turns = Array.from({ length: 4 }, (_, index) => ({
      question: String(index), result: { title: "x", metric: "revenue", dimensions: [], evidence: [] },
    }));
    expect(validateConversationContext({ dataset_id: "dataset-a", turns }, "dataset-a")).toBeNull();
  });

  it("resolves a ranked follow-up and requests clarification when ranking is unavailable", () => {
    const context = validateConversationContext({
      dataset_id: "dataset-a",
      turns: [{ question: "Top category", result: { title: "Revenue", metric: "revenue", dimensions: ["category"], evidence: [...evidence] } }],
    }, "dataset-a")!;
    expect(resolveConversationReference("Compare it with the second one", context).resolved).toBe(context);
    expect(resolveConversationReference("Compare that product with the second one", { dataset_id: "dataset-a", turns: [{ question: "x", result: { title: "x", metric: "revenue", dimensions: [], evidence: [] } }] }).clarification).toBeTruthy();
  });

  it("resolves rankings numerically and clarifies ambiguous ties", () => {
    const context = validateConversationContext({
      dataset_id: "dataset-a",
      turns: [{ question: "Top category", result: { title: "Revenue", metric: "revenue", dimensions: ["category"], evidence: [...evidence] } }],
    }, "dataset-a")!;
    expect(resolveConversationReference("Compare it with the second one", context).resolvedQuery)
      .toBe("Compare Games with Books by revenue");
    const tied = resolveConversationReference("Compare it with the second one", {
      dataset_id: "dataset-a",
      turns: [{ question: "x", result: { title: "x", metric: "revenue", dimensions: ["category"], evidence: [
        { ...evidence[0], value: 100 }, { ...evidence[1], value: 100 },
      ] } }],
    });
    expect(tied.clarification).toBeTruthy();
  });

  it("resolves supported top-product, temporal, and region references", () => {
    const context = validateConversationContext({
      dataset_id: "dataset-a",
      turns: [{ question: "Top category", result: { title: "Revenue", metric: "revenue", dimensions: ["year", "category"], evidence: [...evidence] } }],
    }, "dataset-a")!;
    expect(resolveConversationReference("Show the top product", context).resolvedQuery).toBe("Show Games");
    expect(resolveConversationReference("What about 2025?", context, ["year"]).resolvedQuery).toContain("2025");
    expect(resolveConversationReference("Break that down by region", context, ["region"]).resolvedQuery)
      .toBe("Break down revenue by region");
  });

  it("clarifies unsupported temporal and region references without inventing columns", () => {
    const context = validateConversationContext({
      dataset_id: "dataset-a",
      turns: [{ question: "Top category", result: { title: "Revenue", metric: "revenue", dimensions: ["category"], evidence: [...evidence] } }],
    }, "dataset-a")!;
    expect(resolveConversationReference("What about 2025?", context).clarification).toBeTruthy();
    expect(resolveConversationReference("Break that down by region", context).clarification).toBeTruthy();
  });
});
