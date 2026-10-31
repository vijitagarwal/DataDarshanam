import type { EvidenceItem } from "./engine/types";

export interface ConversationTurn {
  question: string;
  result: {
    title: string;
    metric: string;
    dimensions: string[];
    evidence: EvidenceItem[];
  };
}

export interface ConversationEnvelope {
  dataset_id: string;
  turns: ConversationTurn[];
}

export interface ConversationResolution {
  resolved?: ConversationEnvelope;
  resolvedQuery?: string;
  clarification?: string;
  temporalFilter?: { field: string; year: string };
}

export function validateConversationContext(value: unknown, datasetId: string): ConversationEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.dataset_id !== datasetId || !Array.isArray(envelope.turns)) return null;
  if (JSON.stringify(envelope).length > 20_000 || envelope.turns.length > 3) return null;
  const turns: ConversationTurn[] = [];
  for (const raw of envelope.turns) {
    if (!raw || typeof raw !== "object") return null;
    const turn = raw as Record<string, unknown>;
    const result = turn.result as Record<string, unknown> | undefined;
    if (typeof turn.question !== "string" || !result ||
        typeof result.title !== "string" || typeof result.metric !== "string" ||
        !Array.isArray(result.dimensions) || !result.dimensions.every((item) => typeof item === "string") ||
        !Array.isArray(result.evidence) || result.evidence.length > 20) return null;
    const evidence = result.evidence as unknown[];
    if (evidence.some((item) => !item || typeof item !== "object" ||
        typeof (item as EvidenceItem).id !== "string" ||
        typeof (item as EvidenceItem).metric !== "string" ||
        typeof (item as EvidenceItem).label !== "string" ||
        typeof (item as EvidenceItem).context !== "string" ||
        !["total", "average", "highest", "lowest", "rank", "share", "difference", "change", "trend", "missing_period", "outlier"].includes((item as EvidenceItem).calculationType) ||
        !(["number", "string"].includes(typeof (item as EvidenceItem).value) || (item as EvidenceItem).value === null) ||
        (typeof (item as EvidenceItem).value === "number" && !Number.isFinite((item as EvidenceItem).value)))) return null;
    turns.push({
      question: turn.question.slice(0, 500),
      result: {
        title: String(result.title).slice(0, 200),
        metric: String(result.metric).slice(0, 100),
        dimensions: result.dimensions.map(String),
        evidence: evidence as EvidenceItem[],
      },
    });
  }
  return { dataset_id: datasetId, turns };
}

export function resolveConversationReference(
  question: string,
  context: ConversationEnvelope,
  supportedColumns: string[] = [],
): ConversationResolution {
  const normalized = question.toLowerCase();
  const last = context.turns.at(-1);
  if (!last) return {};
  const rankFacts = last.result.evidence
    .filter((item) => item.calculationType === "rank" && typeof item.value === "number")
    .sort((a, b) => (b.value as number) - (a.value as number));
  if (/compare\s+(it|that product|the top one)\s+with\s+the\s+second/i.test(normalized)) {
    if (rankFacts.length < 2 || !rankFacts[0].category || !rankFacts[1].category) {
      return { clarification: "The previous result does not contain two clearly ranked categories. Which categories should I compare?" };
    }
    if (rankFacts[0].value === rankFacts[1].value) {
      return { clarification: "The first two positions are tied. Which category should I compare?" };
    }
    return {
      resolved: context,
      resolvedQuery: `Compare ${rankFacts[0].category} with ${rankFacts[1].category} by ${last.result.metric}`,
    };
  }
  if (/that product|the top one/.test(normalized) && last.result.evidence.filter((item) => item.category).length === 0) {
    return { clarification: "Which category or product do you mean from the previous result?" };
  }
  if (/^show\s+(the\s+)?top\s+(product|item|category)/i.test(normalized)) {
    const top = rankFacts[0] ?? last.result.evidence.find((item) => item.calculationType === "highest" && typeof item.value === "number");
    if (!top?.category) return { clarification: "Which product or category from the previous result should I show?" };
    return { resolved: context, resolvedQuery: `Show ${top.category}` };
  }
  const temporal = question.match(/\b(19|20)\d{2}\b/);
  if (temporal) {
    const columns = [...last.result.dimensions, ...supportedColumns];
    const temporalColumns = columns.filter((column) => /year|month|quarter|date|period/i.test(column));
    if (!temporalColumns.some((column) => /year/i.test(column))) {
      return { clarification: `The selected dataset does not provide a supported year filter. Which supported period should I use?` };
    }
    const year = temporal[0];
    const yearColumn = temporalColumns.find((column) => /^year$/i.test(column.trim())) ?? temporalColumns.find((column) => /year/i.test(column));
    if (!yearColumn) return { clarification: "The selected dataset does not provide a supported year filter. Which supported period should I use?" };
    return { resolved: context, resolvedQuery: `${question.trim()} ${year}`, temporalFilter: { field: yearColumn, year } };
  }
  if (/break\s+(it|that|this)\s+down\s+by\s+region/i.test(normalized)) {
    const regionColumn = supportedColumns.find((column) => /^region$/i.test(column.trim()));
    if (!regionColumn) return { clarification: "The selected dataset does not contain a region column. Which available dimension should I use?" };
    return { resolved: context, resolvedQuery: `Break down ${last.result.metric} by ${regionColumn}` };
  }
  return { resolved: context };
}
