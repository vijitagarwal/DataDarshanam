"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";
import { deleteDocument, listDocuments, uploadDocument, type DocumentItem } from "@/lib/documentApi";

const ACCEPTED = ".pdf,.docx,.txt,.md,.markdown";

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: DocumentItem["status"]) {
  return status === "awaiting_upload" ? "Waiting for upload" : status.charAt(0).toUpperCase() + status.slice(1);
}

interface DocumentManagerProps {
  onDocumentsChange?: (documents: DocumentItem[]) => void;
  onLoadingChange?: (loading: boolean) => void;
  onErrorChange?: (error: string | null) => void;
}

export function DocumentManager({
  onDocumentsChange,
  onLoadingChange,
  onErrorChange,
}: DocumentManagerProps) {
  const [user, setUser] = useState<User | null>(null);
  const [configured, setConfigured] = useState(true);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadedUserId = useRef<string | null>(null);

  useEffect(() => {
    onDocumentsChange?.(documents);
  }, [documents, onDocumentsChange]);

  const refresh = useCallback(async () => {
    if (!user) {
      setDocuments([]);
      onDocumentsChange?.([]);
      return;
    }
    setLoading(true);
    onLoadingChange?.(true);
    setError(null);
    onErrorChange?.(null);
    try {
      setDocuments(await listDocuments());
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to load documents.";
      setError(message);
      onErrorChange?.(message);
    } finally {
      setLoading(false);
      onLoadingChange?.(false);
    }
  }, [user, onDocumentsChange, onErrorChange, onLoadingChange]);

  useEffect(() => {
    let active = true;
    try {
      const supabase = getBrowserSupabaseClient();
      void supabase.auth.getSession().then(({ data }) => {
        if (active) {
          const nextUser = data.session?.user ?? null;
          if (loadedUserId.current !== (nextUser?.id ?? null)) {
            loadedUserId.current = nextUser?.id ?? null;
            setDocuments([]);
            onDocumentsChange?.([]);
          }
          setUser(nextUser);
        }
      }).catch(() => {
        if (active) {
          setConfigured(false);
          setDocuments([]);
          onDocumentsChange?.([]);
        }
      });
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) {
          const nextUser = session?.user ?? null;
          if (loadedUserId.current !== (nextUser?.id ?? null)) {
            loadedUserId.current = nextUser?.id ?? null;
            setDocuments([]);
            onDocumentsChange?.([]);
          }
          setUser(nextUser);
        }
      });
      return () => {
        active = false;
        subscription.subscription.unsubscribe();
      };
    } catch {
      setConfigured(false);
      return () => { active = false; };
    }
  }, [onDocumentsChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!configured || !user) return null;

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    onErrorChange?.(null);
    setMessage(null);
    try {
      const document = await uploadDocument(file);
      setDocuments((current) => [document, ...current]);
      setMessage(`${file.name} uploaded and queued for processing.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload document.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDelete(document: DocumentItem) {
    if (!window.confirm(`Delete "${document.display_name}"?`)) return;
    setError(null);
    onErrorChange?.(null);
    try {
      await deleteDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to delete document.");
      void refresh();
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl rounded-2xl border border-indigo-500/15 bg-slate-900/45 p-4 shadow-xl md:p-5" aria-labelledby="documents-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="documents-heading" className="flex items-center gap-2 text-sm font-semibold text-white">
            <FileText className="h-4 w-4 text-indigo-300" /> Private documents
          </h2>
          <p className="mt-1 text-xs text-slate-400">Upload PDF, DOCX, TXT, or Markdown files for your account.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-400 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
          {uploading ? "Uploading..." : "Upload document"}
          <input ref={inputRef} type="file" accept={ACCEPTED} disabled={uploading} className="sr-only" onChange={(event) => void handleUpload(event.target.files?.[0])} />
        </label>
      </div>
      {message && <p className="mt-3 text-xs text-emerald-300" role="status">{message}</p>}
      {error && <p className="mt-3 text-xs text-rose-300" role="alert">{error}</p>}
      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your documents...</p>
      ) : documents.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">No documents yet. Upload a private business document to get started.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-200">{document.display_name}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{formatBytes(document.byte_size)} · {statusLabel(document.status)}</p>
                {document.ingestion_error_message && <p className="mt-1 text-[11px] text-rose-300">{document.ingestion_error_message}</p>}
              </div>
              <button type="button" onClick={() => void handleDelete(document)} className="shrink-0 rounded-md p-1.5 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300" aria-label={`Delete ${document.display_name}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
