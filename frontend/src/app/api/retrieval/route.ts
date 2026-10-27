import { NextResponse } from "next/server";
import { GeminiEmbeddingProvider } from "@/lib/embeddings/gemini";
import {
  DEFAULT_RETRIEVAL_LIMIT,
  MAX_RETRIEVAL_DOCUMENT_IDS,
  MAX_RETRIEVAL_LIMIT,
  MAX_RETRIEVAL_QUERY_LENGTH,
  RetrievalError,
  retrieveDocumentChunks,
} from "@/lib/embeddings/retrievalService";
import { authenticateRequest, getBearerToken } from "@/lib/supabase/auth";
import { createUserSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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

interface RetrievalRequest {
  query: string;
  documentIds?: string[];
  limit: number;
}

function parseRetrievalRequest(value: unknown): RetrievalRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.query !== "string") return null;
  if (body.documentIds !== undefined &&
      (!Array.isArray(body.documentIds) ||
       body.documentIds.length > MAX_RETRIEVAL_DOCUMENT_IDS ||
       !body.documentIds.every(id => typeof id === "string" && UUID_PATTERN.test(id)))) {
    return null;
  }
  const limit = body.limit === undefined ? DEFAULT_RETRIEVAL_LIMIT : body.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_RETRIEVAL_LIMIT) return null;
  return {
    query: body.query,
    documentIds: body.documentIds as string[] | undefined,
    limit: limit as number,
  };
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: { code: auth.code, message: auth.message } }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: "Retrieval request is too large." } },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Retrieval request is too large." } },
        { status: 413 },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }
  const input = parseRetrievalRequest(body);
  if (!input) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: "Provide a query, optional document IDs, and a result limit from 1 to 20." } },
      { status: 400 },
    );
  }
  if (!input.query.trim() || input.query.trim().length > MAX_RETRIEVAL_QUERY_LENGTH) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: `Query must contain 1 to ${MAX_RETRIEVAL_QUERY_LENGTH.toLocaleString()} characters.` } },
      { status: 400 },
    );
  }

  const accessToken = getBearerToken(request);
  if (!accessToken) {
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Authentication is required." } },
      { status: 401 },
    );
  }

  try {
    const matches = await retrieveDocumentChunks(
      createUserSupabaseClient(accessToken),
      new GeminiEmbeddingProvider(),
      input.query,
      input.documentIds,
      input.limit,
    );
    return NextResponse.json({
      success: true,
      status: matches.length > 0 ? "matches" : "no_matches",
      matches,
    });
  } catch (error) {
    if (error instanceof RetrievalError) {
      if (error.code === "INVALID_INPUT") {
        return NextResponse.json(
          { success: false, error: { code: error.code, message: error.message } },
          { status: 400 },
        );
      }
      if (error.code === "INCOMPATIBLE_EMBEDDINGS") {
        return NextResponse.json(
          { success: false, error: { code: error.code, message: error.message } },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: "RETRIEVAL_FAILED", message: "Document retrieval failed. Please retry." } },
      { status: 503 },
    );
  }
}
