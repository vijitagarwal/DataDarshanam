import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

export interface AnswerSource {
  documentId: string;
  documentName: string;
  chunkId: string;
  chunkIndex: number;
  sourceStart: number;
  sourceEnd: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: string[] | null;
}

export interface DocumentAnswer {
  status: "answered" | "insufficient_evidence" | "no_evidence";
  answer: string | null;
  sources: AnswerSource[];
}

interface ApiErrorBody {
  success: false;
  error?: { code?: string; message?: string };
}

export class DocumentQaApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "DocumentQaApiError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSource(value: unknown): AnswerSource | null {
  if (!isRecord(value) ||
      typeof value.documentId !== "string" ||
      !UUID_PATTERN.test(value.documentId) ||
      typeof value.documentName !== "string" ||
      typeof value.chunkId !== "string" ||
      !UUID_PATTERN.test(value.chunkId) ||
      !Number.isInteger(value.chunkIndex) ||
      (value.chunkIndex as number) < 0 ||
      !Number.isInteger(value.sourceStart) ||
      (value.sourceStart as number) < 0 ||
      !Number.isInteger(value.sourceEnd) ||
      (value.sourceEnd as number) <= (value.sourceStart as number) ||
      (value.pageStart !== null && (!Number.isInteger(value.pageStart) || (value.pageStart as number) < 1)) ||
      (value.pageEnd !== null && (!Number.isInteger(value.pageEnd) || (value.pageEnd as number) < 1)) ||
      (typeof value.pageStart === "number" &&
        typeof value.pageEnd === "number" &&
        value.pageEnd < value.pageStart) ||
      (value.sectionPath !== null &&
        (!Array.isArray(value.sectionPath) || !value.sectionPath.every(item => typeof item === "string")))) {
    return null;
  }
  return {
    documentId: value.documentId,
    documentName: value.documentName,
    chunkId: value.chunkId,
    chunkIndex: value.chunkIndex as number,
    sourceStart: value.sourceStart as number,
    sourceEnd: value.sourceEnd as number,
    pageStart: value.pageStart as number | null,
    pageEnd: value.pageEnd as number | null,
    sectionPath: value.sectionPath as string[] | null,
  };
}

export function validateDocumentAnswer(value: unknown): DocumentAnswer | null {
  if (!isRecord(value) || value.success !== true || !Array.isArray(value.sources)) return null;
  const sources = value.sources.map(validateSource);
  if (sources.some(source => source === null)) return null;
  if (value.status === "no_evidence") {
    return value.answer === null && sources.length === 0
      ? { status: "no_evidence", answer: null, sources: [] }
      : null;
  }
  if (typeof value.answer !== "string" || !value.answer.trim() || value.answer.length > 4_000) return null;
  if (value.status === "insufficient_evidence") {
    return sources.length === 0
      ? { status: "insufficient_evidence", answer: value.answer, sources: [] }
      : null;
  }
  if (value.status !== "answered" || sources.length === 0) return null;
  const sourceIds = sources.map(source => source!.chunkId);
  if (new Set(sourceIds).size !== sourceIds.length) return null;
  return {
    status: "answered",
    answer: value.answer,
    sources: sources as AnswerSource[],
  };
}

export async function askDocumentQuestion(
  question: string,
  documentIds?: readonly string[],
): Promise<DocumentAnswer> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion || normalizedQuestion.length > 5_000) {
    throw new DocumentQaApiError("INVALID_INPUT", "Enter a question of 1 to 5,000 characters.");
  }
  if (documentIds && documentIds.some(id => !UUID_PATTERN.test(id))) {
    throw new DocumentQaApiError("INVALID_INPUT", "One or more selected documents are invalid.");
  }

  let token: string | undefined;
  try {
    const { data } = await getBrowserSupabaseClient().auth.getSession();
    token = data.session?.access_token;
  } catch {
    throw new DocumentQaApiError("AUTHENTICATION_REQUIRED", "Sign in to ask questions about your documents.");
  }
  if (!token) {
    throw new DocumentQaApiError("AUTHENTICATION_REQUIRED", "Your session has expired. Please sign in again.");
  }

  let response: Response;
  try {
    response = await fetch("/api/answers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: normalizedQuestion,
        ...(documentIds && documentIds.length > 0 ? { documentIds: [...documentIds] } : {}),
      }),
    });
  } catch {
    throw new DocumentQaApiError("NETWORK_ERROR", "Could not reach document Q&A. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await response.json() as unknown;
  } catch {
    throw new DocumentQaApiError("INVALID_RESPONSE", "The server returned an unreadable response.", response.status);
  }

  if (!response.ok) {
    const errorBody = body as ApiErrorBody;
    const code = isRecord(errorBody) &&
      isRecord(errorBody.error) &&
      typeof errorBody.error.code === "string"
      ? errorBody.error.code
      : "REQUEST_FAILED";
    if (response.status === 401) {
      try {
        await getBrowserSupabaseClient().auth.signOut();
      } catch {
        // The user-facing session-expiry message remains useful if sign-out cleanup fails.
      }
      throw new DocumentQaApiError("AUTHENTICATION_REQUIRED", "Your session has expired. Please sign in again.", 401);
    }
    if (code === "FEATURE_DISABLED") {
      throw new DocumentQaApiError(code, "Document Q&A is not available yet. Please try again later.", response.status);
    }
    if (typeof errorBody?.error?.message === "string") {
      throw new DocumentQaApiError(code, errorBody.error.message, response.status);
    }
    throw new DocumentQaApiError(code, "Document Q&A could not complete this request.", response.status);
  }

  const answer = validateDocumentAnswer(body);
  if (!answer) {
    throw new DocumentQaApiError("INVALID_RESPONSE", "The server returned an unexpected answer format.", response.status);
  }
  return answer;
}
