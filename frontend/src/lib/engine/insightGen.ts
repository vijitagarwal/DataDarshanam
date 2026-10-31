/**
 * Insight Generator — TypeScript port of insight_gen.py
 * Generates 2-3 sentence AI insights from query results using Groq.
 */

import Groq from "groq-sdk";
import { QueryResult } from "./types";
import { generateAnalyticalEvidence } from "./analyticalEvidence";

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const SYSTEM_PROMPT = "Return JSON only: {\"headline\":\"...\",\"explanation\":\"...\",\"evidence_ids\":[\"F1\"]}. Use only supplied fact IDs. Never calculate, estimate, or invent numbers. Do not include a fact value unless the fact is referenced by ID.";

function containsNumericText(value: string): boolean {
  if (/[\d]/.test(value)) return true;
  return /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion|percent|percentage)\b/i.test(value);
}

function fallbackInsight(result: QueryResult): string {
  const evidence = generateAnalyticalEvidence(result);
  const rawMetric = result.metric ?? "value";
  const metric = rawMetric.replace(/_/g, " ");
  const highest = evidence.facts.find((fact) => fact.calculationType === "highest" && typeof fact.value === "number");
  if (!highest || typeof highest.value !== "number") {
    return "Computed result available; the evidence packet has no verified numeric headline.";
  }
  const label = highest.category ? `${highest.category} with ` : "";
  return `${label}${highest.value.toLocaleString(undefined, { maximumFractionDigits: 6 })} is the highest verified ${metric}. [${highest.id}]`;
}

export async function generateInsight(userQuery: string, result: QueryResult): Promise<{ insight: string; fallback: boolean }> {
  if (result.error) {
    return { insight: result.message ?? "An unknown error occurred.", fallback: false };
  }
  if (!result.data?.length) {
    return { insight: "No data was returned for this query. Try adjusting your filters or broadening the date range.", fallback: false };
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { insight: fallbackInsight(result), fallback: true };
  }

  try {
    const client = new Groq({ apiKey });
    const evidence = generateAnalyticalEvidence(result);
    const completion = client.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ question: userQuery, evidence }) },
      ],
      temperature: 0.7,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
    const response = await Promise.race([
      completion,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Groq request timed out")), 15_000)),
    ]);

    const content = response.choices[0].message.content ?? "";
    if (content.length > 2_000) return { insight: fallbackInsight(result), fallback: true };
    const parsed = JSON.parse(content) as { headline?: unknown; explanation?: unknown; evidence_ids?: unknown };
    if (!parsed || typeof parsed !== "object" || Object.keys(parsed).some((key) => !["headline", "explanation", "evidence_ids"].includes(key))) {
      return { insight: fallbackInsight(result), fallback: true };
    }
    if (typeof parsed.headline !== "string" || typeof parsed.explanation !== "string" ||
        !Array.isArray(parsed.evidence_ids) || parsed.evidence_ids.some((id) => typeof id !== "string")) {
      return { insight: fallbackInsight(result), fallback: true };
    }
    const knownIds = new Set(evidence.facts.map((item) => item.id));
    const refs = parsed.evidence_ids as string[];
    if (refs.length !== new Set(refs).size || refs.some((id) => !knownIds.has(id))) {
      return { insight: fallbackInsight(result), fallback: true };
    }
    const proseParts = [parsed.headline.trim(), parsed.explanation.trim()];
    if (proseParts.some((value) => !value || value.length > 500 || containsNumericText(value))) {
      return { insight: fallbackInsight(result), fallback: true };
    }
    const evidenceText = evidence.facts
      .filter((item) => refs.includes(item.id))
      .map((item) => `${item.label}: ${typeof item.value === "number" ? item.value.toLocaleString() : item.value} [${item.id}]`);
    const insight = `${parsed.headline.trim()} ${parsed.explanation.trim()}`.trim();
    if (!insight || insight.length > 2_000) return { insight: fallbackInsight(result), fallback: true };
    return { insight: evidenceText.length ? `${insight}\n${evidenceText.join("\n")}` : insight, fallback: false };
  } catch {
    return { insight: fallbackInsight(result), fallback: true };
  }
}
