import { NextResponse } from "next/server";
import { GeminiEmbeddingProvider } from "@/lib/embeddings/gemini";
import {
  DEFAULT_RETRIEVAL_LIMIT,
  MAX_RETRIEVAL_DOCUMENT_IDS,
  MAX_RETRIEVAL_QUERY_LENGTH,
  RetrievalError,
  retrieveDocumentChunks,
} from "@/lib/embeddings/retrievalService";
import { generateGroundedAnswer, GroundedAnswerError } from "@/lib/groundedAnswer";
import { authenticateRequest, getBearerToken } from "@/lib/supabase/auth";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 45;

const MAX_REQUEST_BYTES = 20_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class RequestTooLargeError extends Error {}

async function readJsonBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("empty request body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteCount += value.byteLength;
    if (byteCount > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestTooLargeError();
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return JSON.parse(body) as unknown;
}

interface AnswerRequest {
  question: string;
  documentIds?: string[];
}

function parseAnswerRequest(value: unknown): AnswerRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== "question" && key !== "documentIds")) return null;
  if (typeof body.question !== "string") return null;
  if (body.documentIds !== undefined &&
      (!Array.isArray(body.documentIds) ||
       body.documentIds.length > MAX_RETRIEVAL_DOCUMENT_IDS ||
       !body.documentIds.every(id => typeof id === "string" && UUID_PATTERN.test(id)) ||
       new Set(body.documentIds).size !== body.documentIds.length)) {
    return null;
  }
  return { question: body.question, documentIds: body.documentIds as string[] | undefined };
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    return errorResponse(auth.code, auth.message, 401);
  }
  if (process.env.DOCUMENT_RAG_ANSWERS_ENABLED !== "true") {
    return errorResponse("FEATURE_DISABLED", "Document question answering is not enabled.", 503);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return errorResponse("INVALID_INPUT", "Answer request is too large.", 413);
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    return error instanceof RequestTooLargeError
      ? errorResponse("INVALID_INPUT", "Answer request is too large.", 413)
      : errorResponse("INVALID_INPUT", "Request body must be valid JSON.", 400);
  }
  const input = parseAnswerRequest(body);
  if (!input) {
    return errorResponse("INVALID_INPUT", "Provide a question and an optional list of document IDs.", 400);
  }
  const question = input.question.trim();
  if (!question || question.length > MAX_RETRIEVAL_QUERY_LENGTH) {
    return errorResponse(
      "INVALID_INPUT",
      `Question must contain 1 to ${MAX_RETRIEVAL_QUERY_LENGTH.toLocaleString()} characters.`,
      400,
    );
  }

  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return errorResponse("UNAUTHENTICATED", "Authentication is required.", 401);
  }

  try {
    const evidence = await retrieveDocumentChunks(
      createUserSupabaseClient(accessToken),
      new GeminiEmbeddingProvider(),
      question,
      input.documentIds,
      DEFAULT_RETRIEVAL_LIMIT,
    );
    if (evidence.length === 0) {
      return NextResponse.json({
        success: true,
        status: "no_evidence",
        answer: null,
        sources: [],
      });
    }

    const answer = await generateGroundedAnswer(question, evidence);
    return NextResponse.json({
      success: true,
      status: answer.status,
      answer: answer.answer,
      sources: answer.sources,
    });
  } catch (error) {
    if (error instanceof RetrievalError) {
      const status = error.code === "INVALID_INPUT" ? 400 : 503;
      return errorResponse(error.code, error.message, status);
    }
    if (error instanceof GroundedAnswerError) {
      if (error.code === "INVALID_INPUT") {
        return errorResponse(error.code, error.message, 400);
      }
      if (error.code === "CONTEXT_TOO_LARGE") {
        return errorResponse(error.code, error.message, 413);
      }
      if (error.code === "INVALID_PROVIDER_RESPONSE") {
        return errorResponse(error.code, "Answer generation returned an invalid response.", 502);
      }
      return errorResponse(error.code, error.message, 503);
    }
    return errorResponse("ANSWER_FAILED", "Document question answering failed. Please retry.", 503);
  }
}
