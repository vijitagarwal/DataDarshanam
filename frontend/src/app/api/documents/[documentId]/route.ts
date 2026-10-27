import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET, isUuid } from "@/lib/supabase/documents";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ documentId: string }>;
}

async function getId(context: RouteContext) {
  const { documentId } = await context.params;
  return isUuid(documentId) ? documentId : null;
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth }, { status: 401 });
  const documentId = await getId(context);
  if (!documentId) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

  try {
    const client = createServiceRoleSupabaseClient();
    const { data, error } = await client.from("documents")
      .select("id,display_name,original_filename,media_type,byte_size,status,chunk_count,created_at,updated_at,completed_at,deleted_at,ingestion_error_code,ingestion_error_message")
      .eq("id", documentId).eq("user_id", auth.user.id).maybeSingle();
    if (error) {
      console.error("Document status lookup failed");
      return NextResponse.json({ success: false, error: { code: "DOCUMENT_LOOKUP_FAILED", message: "Unable to retrieve document status." } }, { status: 500 });
    }
    if (!data) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });
    return NextResponse.json({ success: true, document: data });
  } catch {
    return NextResponse.json({ success: false, error: { code: "DOCUMENT_LOOKUP_FAILED", message: "Unable to retrieve document status." } }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth }, { status: 401 });
  const documentId = await getId(context);
  if (!documentId) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

  try {
    const client = createServiceRoleSupabaseClient();
    const { data, error } = await client.from("documents")
      .select("id,storage_path,status").eq("id", documentId).eq("user_id", auth.user.id).maybeSingle();
    if (error) {
      console.error("Document deletion lookup failed");
      return NextResponse.json({ success: false, error: { code: "DOCUMENT_DELETE_FAILED", message: "Unable to delete document." } }, { status: 500 });
    }
    if (!data) return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });
    if (data.status === "deleted") return NextResponse.json({ success: true, status: "deleted" });

    const { error: markError } = await client.from("documents").update({ status: "deleting" })
      .eq("id", documentId).eq("user_id", auth.user.id);
    if (markError) throw markError;
    const { error: storageError } = await client.storage.from(DOCUMENT_BUCKET).remove([data.storage_path]);
    if (storageError) {
      console.error("Document storage cleanup failed");
      return NextResponse.json({ success: false, error: { code: "CLEANUP_RETRYABLE", message: "Document deletion is pending cleanup. Please retry." } }, { status: 503 });
    }
    const { error: deleteError } = await client.from("documents").delete().eq("id", documentId).eq("user_id", auth.user.id);
    if (deleteError) throw deleteError;
    return NextResponse.json({ success: true, status: "deleted" });
  } catch {
    return NextResponse.json({ success: false, error: { code: "DOCUMENT_DELETE_FAILED", message: "Unable to delete document." } }, { status: 500 });
  }
}
