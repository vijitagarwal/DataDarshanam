import { NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/supabase/auth";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { validateUploadMetadata, createDocumentId, createStoragePath, DOCUMENT_BUCKET } from "@/lib/supabase/documents";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth }, { status: 401 });

  try {
    const client = createServiceRoleSupabaseClient();
    const { data, error } = await client
      .from("documents")
      .select("id,display_name,original_filename,media_type,byte_size,status,chunk_count,created_at,updated_at,completed_at,deleted_at,ingestion_error_code")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("Document listing failed");
      return NextResponse.json({ success: false, error: { code: "DOCUMENT_LIST_FAILED", message: "Unable to list documents." } }, { status: 500 });
    }
    return NextResponse.json({ success: true, documents: data ?? [] });
  } catch {
    return NextResponse.json({ success: false, error: { code: "DOCUMENT_LIST_FAILED", message: "Unable to list documents." } }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth }, { status: 401 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: { code: "INVALID_REQUEST", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const validation = validateUploadMetadata(input);
  if (!validation.valid) {
    return NextResponse.json({ success: false, error: { code: "INVALID_UPLOAD", message: validation.message } }, { status: 400 });
  }

  const documentId = createDocumentId();
  const storagePath = createStoragePath(auth.user.id, documentId, validation.extension);
  try {
    const client = createServiceRoleSupabaseClient();
    const { error: insertError } = await client.from("documents").insert({
      id: documentId,
      user_id: auth.user.id,
      display_name: validation.metadata.displayName ?? validation.metadata.filename,
      original_filename: validation.metadata.filename,
      media_type: validation.metadata.mediaType,
      file_extension: validation.extension,
      byte_size: validation.metadata.byteSize,
      storage_bucket: DOCUMENT_BUCKET,
      storage_path: storagePath,
      status: "awaiting_upload",
    });
    if (insertError) {
      console.error("Document metadata creation failed");
      return NextResponse.json({ success: false, error: { code: "DOCUMENT_CREATE_FAILED", message: "Unable to initialize document upload." } }, { status: 500 });
    }

    const { data: signedUpload, error: uploadError } = await client.storage
      .from(DOCUMENT_BUCKET)
      .createSignedUploadUrl(storagePath);
    if (uploadError || !signedUpload?.token) {
      await client.from("documents").delete().eq("id", documentId).eq("user_id", auth.user.id);
      console.error("Signed upload creation failed");
      return NextResponse.json({ success: false, error: { code: "UPLOAD_URL_FAILED", message: "Unable to initialize secure upload." } }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      document: { id: documentId, status: "awaiting_upload", display_name: validation.metadata.displayName ?? validation.metadata.filename },
      upload: { bucket: DOCUMENT_BUCKET, path: storagePath, token: signedUpload.token },
    }, { status: 201 });
  } catch {
    return NextResponse.json({ success: false, error: { code: "DOCUMENT_CREATE_FAILED", message: "Unable to initialize document upload." } }, { status: 500 });
  }
}
