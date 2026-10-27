import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/supabase/documents";
import { processIngestionJob } from "@/lib/ingestion/ingestionService";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth }, { status: 401 });
  const { documentId } = await context.params;
  if (!isUuid(documentId)) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });
  }

  try {
    const result = await processIngestionJob(createServiceRoleSupabaseClient(), documentId, auth.user.id);
    if (result.errorCode === "NOT_FOUND") {
      return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });
    }
    if (result.errorCode === "INVALID_STATUS") {
      return NextResponse.json({ success: false, error: { code: "INVALID_STATUS", message: "Document is not queued for processing." } }, { status: 409 });
    }
    if (result.status === "failed") {
      return NextResponse.json({
        success: false,
        status: "failed",
        error: { code: result.errorCode ?? "INGESTION_FAILED", message: "Document processing failed. Retry after checking the document status." },
      }, { status: 422 });
    }
    return NextResponse.json({ success: true, status: "ready", chunk_count: result.chunkCount });
  } catch {
    return NextResponse.json({ success: false, error: { code: "INGESTION_FAILED", message: "Document processing failed. Please retry." } }, { status: 500 });
  }
}
