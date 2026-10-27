import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

export interface DocumentItem {
  id: string;
  display_name: string;
  original_filename: string;
  media_type: string;
  byte_size: number;
  status: "awaiting_upload" | "queued" | "processing" | "ready" | "failed" | "deleting" | "deleted";
  chunk_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
  ingestion_error_code: string | null;
  ingestion_error_message?: string | null;
}

interface DocumentError {
  code: string;
  message: string;
}

interface DocumentListResponse {
  success: boolean;
  documents?: DocumentItem[];
  error?: DocumentError;
}

interface UploadInitResponse {
  success: boolean;
  document?: Pick<DocumentItem, "id" | "display_name" | "status">;
  upload?: { bucket: string; path: string; token: string };
  error?: DocumentError;
}

interface CompletionResponse {
  success: boolean;
  document_id?: string;
  status?: DocumentItem["status"];
  job_id?: string;
  idempotent?: boolean;
  error?: DocumentError;
}

async function authenticatedRequest(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await getBrowserSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");

  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (response.status === 401) {
    await getBrowserSupabaseClient().auth.signOut();
    throw new Error("Your session has expired. Please sign in again.");
  }
  return response;
}

async function parseResponse<T extends { success: boolean; error?: DocumentError }>(response: Response): Promise<T> {
  const body = await response.json() as T;
  if (!response.ok || !body.success) {
    throw new Error(body.error?.message ?? `Document request failed (${response.status}).`);
  }
  return body;
}

export async function listDocuments(): Promise<DocumentItem[]> {
  const body = await parseResponse<DocumentListResponse>(await authenticatedRequest("/api/documents"));
  return body.documents ?? [];
}

export async function uploadDocument(file: File, displayName?: string): Promise<DocumentItem> {
  const initBody = await parseResponse<UploadInitResponse>(await authenticatedRequest("/api/documents", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mediaType: file.type,
      byteSize: file.size,
      displayName,
    }),
  }));
  if (!initBody.document || !initBody.upload) throw new Error("The server returned an incomplete upload request.");

  const supabase = getBrowserSupabaseClient();
  const { error: uploadError } = await supabase.storage
    .from(initBody.upload.bucket)
    .uploadToSignedUrl(initBody.upload.path, initBody.upload.token, file);
  if (uploadError) throw new Error("The file could not be uploaded securely. Please retry.");

  const completion = await parseResponse<CompletionResponse>(await authenticatedRequest(
    `/api/documents/${initBody.document.id}/complete`,
    { method: "POST", body: "{}" },
  ));
  return {
    ...initBody.document,
    original_filename: file.name,
    media_type: file.type,
    byte_size: file.size,
    chunk_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completed_at: null,
    deleted_at: null,
    ingestion_error_code: null,
    status: completion.status ?? "queued",
  };
}

export async function deleteDocument(documentId: string): Promise<void> {
  await parseResponse<{ success: boolean; error?: DocumentError }>(
    await authenticatedRequest(`/api/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" }),
  );
}
