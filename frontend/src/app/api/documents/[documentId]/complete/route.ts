import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET, isUuid } from "@/lib/supabase/documents";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth }, { status: 401 });
  const { documentId } = await context.params;
  if (!isUuid(documentId)) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

  let body: unknown = {};
  try { body = await request.json(); } catch { /* optional body */ }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Request body must be a JSON object." } }, { status: 400 });
  }
  const sha256 = (body as Record<string, unknown>).sha256;
  if (sha256 !== undefined && (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256))) {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "sha256 must be a 64-character hexadecimal hash." } }, { status: 400 });
  }

  try {
    const client = createServiceRoleSupabaseClient();
    const { data: document, error } = await client.from("documents")
      .select("id,status,storage_path,byte_size,sha256").eq("id", documentId).eq("user_id", auth.user.id).maybeSingle();
    if (error) throw error;
    if (!document) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });
    if (document.status === "queued" || document.status === "processing" || document.status === "ready") {
      return NextResponse.json({ success: true, document_id: documentId, status: document.status, idempotent: true });
    }
    if (document.status !== "awaiting_upload" && document.status !== "failed") {
      return NextResponse.json({ success: false, error: { code: "INVALID_STATUS", message: "Document cannot be completed in its current state." } }, { status: 409 });
    }

    const objectName = document.storage_path.split("/").pop()!;
    const objectDirectory = document.storage_path.split("/").slice(0, -1).join("/");
    const { data: objectInfo, error: objectError } = await client.storage.from(DOCUMENT_BUCKET).list(
      objectDirectory,
      { search: objectName },
    );
    const uploadedObject = objectInfo?.find(object => object.name === objectName);
    const actualSize = uploadedObject?.metadata?.size;
    const actualSizeNumber = actualSize === undefined ? null : Number(actualSize);
    if (objectError || !uploadedObject || (actualSizeNumber !== null && actualSizeNumber !== document.byte_size)) {
      return NextResponse.json({ success: false, error: { code: "UPLOAD_NOT_FOUND", message: "Uploaded object was not found. Please retry the upload." } }, { status: 409 });
    }
    if (sha256 && document.sha256 && sha256.toLowerCase() !== document.sha256.toLowerCase()) {
      return NextResponse.json({ success: false, error: { code: "UPLOAD_MISMATCH", message: "Uploaded file identity does not match the document." } }, { status: 409 });
    }
    const { error: updateError } = await client.from("documents").update({
      status: "queued",
      sha256: sha256?.toLowerCase() ?? document.sha256,
      ingestion_error_code: null,
      ingestion_error_message: null,
    }).eq("id", documentId).eq("user_id", auth.user.id);
    if (updateError) throw updateError;
    const { data: job, error: jobError } = await client.from("ingestion_jobs").insert({
      document_id: documentId, user_id: auth.user.id, status: "queued",
    }).select("id").single();
    if (jobError) {
      if (jobError.code === "23505") {
        return NextResponse.json({ success: true, document_id: documentId, status: "queued", idempotent: true });
      }
      throw jobError;
    }
    return NextResponse.json({ success: true, document_id: documentId, status: "queued", job_id: job.id });
  } catch {
    return NextResponse.json({ success: false, error: { code: "COMPLETION_FAILED", message: "Unable to complete document upload." } }, { status: 500 });
  }
}
