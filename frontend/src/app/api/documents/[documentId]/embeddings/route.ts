import { NextResponse } from "next/server";
import { GeminiEmbeddingProvider } from "@/lib/embeddings/gemini";
import { processDocumentEmbeddings } from "@/lib/embeddings/embeddingService";
import { EmbeddingProviderError } from "@/lib/embeddings/errors";
import { authenticateRequest } from "@/lib/supabase/auth";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/supabase/documents";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth }, { status: 401 });
  }

  const { documentId } = await context.params;
  if (!isUuid(documentId)) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Document not found." } },
      { status: 404 },
    );
  }

  try {
    const provider = new GeminiEmbeddingProvider();
    const result = await processDocumentEmbeddings(
      createServiceRoleSupabaseClient(),
      provider,
      documentId,
      auth.user.id,
    );

    if (result.status === "not_found") {
      return NextResponse.json(
        { success: false, error: { code: "NOT_FOUND", message: "Document not found." } },
        { status: 404 },
      );
    }
    if (result.status === "invalid_status") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_STATUS", message: "Document must finish extraction before embedding." } },
        { status: 409 },
      );
    }
    if (result.status === "processing") {
      return NextResponse.json({ success: true, status: "processing" }, { status: 202 });
    }
    if (result.status === "failed") {
      const retryable = result.errorCode === "RATE_LIMITED" ||
        result.errorCode === "TRANSIENT_PROVIDER_FAILURE" ||
        result.errorCode === "TIMEOUT" ||
        result.errorCode === "QUOTA_EXCEEDED" ||
        result.errorCode === "PERSISTENCE_FAILED";
      return NextResponse.json({
        success: false,
        status: "failed",
        error: {
          code: result.errorCode,
          message: retryable
            ? "Embedding processing could not finish. Retry later."
            : "The document could not be embedded with the current configuration.",
        },
      }, { status: retryable ? 503 : 422 });
    }
    return NextResponse.json({
      success: true,
      status: "ready",
      part_count: result.partCount,
      reused_count: result.reusedCount,
    });
  } catch (error) {
    const configured = error instanceof EmbeddingProviderError && error.code === "NOT_CONFIGURED";
    return NextResponse.json({
      success: false,
      error: {
        code: configured ? "NOT_CONFIGURED" : "EMBEDDING_FAILED",
        message: configured
          ? "Embedding provider is not configured."
          : "Embedding processing failed. Please retry.",
      },
    }, { status: configured ? 503 : 500 });
  }
}
