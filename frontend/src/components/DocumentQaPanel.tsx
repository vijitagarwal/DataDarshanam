"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { AlertCircle, BookOpenText, Loader2, Send, Sparkles } from "lucide-react";
import { askDocumentQuestion, DocumentQaApiError, type DocumentAnswer } from "@/lib/documentQaApi";
import {
  acquireSubmission,
  releaseSubmission,
  resolveDocumentScope,
  toggleSelectedDocument,
} from "@/lib/documentQaState";
import type { DocumentItem } from "@/lib/documentApi";
import { getBrowserSupabaseClient } from "@/lib/supabase/browser";

const MAX_QUESTION_LENGTH = 5_000;
const EXAMPLE_QUESTIONS = [
  "What are the main requirements in these documents?",
  "Summarize the key dates or deadlines.",
  "What does the policy say about eligibility?",
];

interface DocumentQaPanelProps {
  documents: DocumentItem[];
  documentsLoading: boolean;
  documentsError: string | null;
}

function documentStatus(status: DocumentItem["status"]): string {
  switch (status) {
    case "awaiting_upload": return "Waiting for upload";
    case "queued": return "Queued";
    case "processing": return "Processing";
    case "ready": return "Ready";
    case "failed": return "Failed";
    case "deleting": return "Deleting";
    case "deleted": return "Deleted";
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof DocumentQaApiError) {
    if (error.code === "FEATURE_DISABLED") return error.message;
    if (error.code === "AUTHENTICATION_REQUIRED") return "Your session expired. Sign in again to continue.";
    if (error.code === "PROVIDER_FAILED" || error.code === "DATABASE_FAILED" ||
        error.code === "RETRIEVAL_FAILED" || error.code === "ANSWER_FAILED" ||
        error.code === "INCOMPATIBLE_EMBEDDINGS") {
      return "Document Q&A is temporarily unavailable. Please try again later.";
    }
    return error.message;
  }
  return "Document Q&A could not complete this request. Please try again.";
}

export function DocumentQaPanel({
  documents,
  documentsLoading,
  documentsError,
}: DocumentQaPanelProps) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<DocumentAnswer | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const submitLock = useRef({ active: false });

  useEffect(() => {
    let active = true;
    try {
      const supabase = getBrowserSupabaseClient();
      void supabase.auth.getSession().then(({ data }) => {
        if (active) {
          setUser(data.session?.user ?? null);
          setAuthLoading(false);
        }
      }).catch(() => {
        if (active) {
          setAuthUnavailable(true);
          setAuthLoading(false);
        }
      });
      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (active) {
          setUser(session?.user ?? null);
          if (!session) {
            setAnswer(null);
            setSelectedIds([]);
            setError(null);
          }
        }
      });
      return () => {
        active = false;
        subscription.subscription.unsubscribe();
      };
    } catch {
      setAuthUnavailable(true);
      setAuthLoading(false);
      return () => { active = false; };
    }
  }, []);

  useEffect(() => {
    const availableIds = new Set(documents.filter(document => document.status === "ready").map(document => document.id));
    setSelectedIds(current => current.filter(id => availableIds.has(id)));
  }, [documents]);

  const readyDocuments = documents.filter(document => document.status === "ready");
  const documentScope = resolveDocumentScope(readyDocuments, selectedIds);
  const allDocumentsSelected = documentScope === undefined;
  const selectedCount = documentScope?.length ?? readyDocuments.length;

  function toggleDocument(documentId: string) {
    setSelectedIds(current => toggleSelectedDocument(current, documentId));
    setAnswer(null);
    setError(null);
  }

  async function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (submitting || featureDisabled || !user || !acquireSubmission(submitLock.current)) return;
    if (!normalized || normalized.length > MAX_QUESTION_LENGTH) {
      releaseSubmission(submitLock.current);
      setError("Enter a question of 1 to 5,000 characters.");
      return;
    }
    if (!readyDocuments.length) {
      releaseSubmission(submitLock.current);
      setError("Upload a document and wait for it to finish processing before asking a question.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await askDocumentQuestion(
        normalized,
        documentScope,
      );
      setAnswer(result);
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      if (reason instanceof DocumentQaApiError && reason.code === "FEATURE_DISABLED") {
        setFeatureDisabled(true);
      }
    } finally {
      releaseSubmission(submitLock.current);
      setSubmitting(false);
    }
  }

  return (
    <section
      className="mx-auto w-full max-w-5xl rounded-2xl border border-indigo-500/20 bg-slate-900/55 p-4 shadow-xl md:p-6"
      aria-labelledby="document-qa-heading"
    >
      <div className="mb-5 flex items-start gap-3">
        <div className="rounded-xl bg-indigo-500/15 p-2 text-indigo-300" aria-hidden="true">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 id="document-qa-heading" className="text-base font-semibold text-white">Ask your documents</h2>
          <p className="mt-1 text-sm text-slate-400">
            Answers use passages from your private, processed documents and include source locations where available.
          </p>
        </div>
      </div>

      {authLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-400" role="status">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
        </p>
      ) : authUnavailable ? (
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200" role="alert">
          Document Q&A needs account configuration. Please try again later.
        </p>
      ) : !user ? (
        <p className="rounded-lg border border-slate-700 bg-slate-950/40 p-3 text-sm text-slate-300" role="status">
          Sign in to ask questions about your private documents.
        </p>
      ) : (
        <>
          <fieldset className="mb-5" disabled={submitting || featureDisabled}>
            <legend className="mb-2 text-sm font-medium text-slate-200">Document scope</legend>
            <p className="mb-3 text-xs text-slate-400">
              {allDocumentsSelected
                ? "No individual documents selected — searching all your ready documents."
                : `Searching ${selectedCount} selected document${selectedCount === 1 ? "" : "s"}.`}
            </p>
            {documentsLoading ? (
              <p className="flex items-center gap-2 text-sm text-slate-400" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your documents…
              </p>
            ) : documentsError ? (
              <p className="text-sm text-rose-300" role="alert">{documentsError}</p>
            ) : documents.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">
                No documents yet. Upload one above to get started.
              </p>
            ) : (
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-slate-700/70 bg-slate-950/30 p-3">
                {documents.filter(document => document.status !== "deleted").map(document => {
                  const isReady = document.status === "ready";
                  return (
                    <label
                      key={document.id}
                      className={`flex items-start gap-3 rounded-md p-2 text-sm ${isReady ? "cursor-pointer hover:bg-slate-800/60" : "cursor-not-allowed opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(document.id)}
                        disabled={!isReady}
                        onChange={() => toggleDocument(document.id)}
                        className="mt-0.5 h-4 w-4 accent-indigo-500"
                        aria-label={`Include ${document.display_name}`}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-slate-200">{document.display_name}</span>
                        <span className="block text-xs text-slate-400">
                          {documentStatus(document.status)}
                          {!isReady && document.status !== "failed" ? " — available after processing" : ""}
                          {isReady ? " — extracted; retrieval evidence may still be unavailable" : ""}
                        </span>
                      </span>
                    </label>
                  );
                })}
                {readyDocuments.length === 0 && (
                  <p className="text-xs text-amber-200">
                    No documents are ready yet. The document manager does not expose a manual retry action.
                  </p>
                )}
              </div>
            )}
          </fieldset>

          <form onSubmit={submitQuestion} className="space-y-3">
            <label htmlFor="document-question" className="block text-sm font-medium text-slate-200">
              Your question
            </label>
            <textarea
              id="document-question"
              value={question}
              onChange={event => {
                setQuestion(event.target.value);
                if (error) setError(null);
              }}
              maxLength={MAX_QUESTION_LENGTH}
              rows={3}
              placeholder="Ask a question grounded in your documents…"
              disabled={submitting || featureDisabled || documentsLoading || !!documentsError || !user}
              className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              aria-describedby="question-hint question-count"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p id="question-hint" className="text-xs text-slate-400">Up to 5,000 characters. No conversation is saved.</p>
              <p id="question-count" className="text-xs text-slate-500" aria-live="polite">
                {question.length.toLocaleString()} / {MAX_QUESTION_LENGTH.toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <button
                type="submit"
                disabled={submitting || featureDisabled || documentsLoading || !!documentsError || !user || !question.trim() || !readyDocuments.length}
                className="btn-primary inline-flex min-h-10 items-center gap-2 px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {submitting ? "Searching your documents…" : "Ask"}
              </button>
            </div>
          </form>

          {!answer && !error && !featureDisabled && (
            <div className="mt-5 border-t border-slate-800 pt-4">
              <p className="mb-2 text-xs font-medium text-slate-400">Example questions</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_QUESTIONS.map(example => (
                  <button
                    key={example}
                    type="button"
                    disabled={submitting}
                    onClick={() => setQuestion(example)}
                    className="rounded-full border border-slate-700 px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-indigo-400/60 hover:text-white focus-visible:outline-indigo-300 disabled:opacity-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {featureDisabled && (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100" role="status">
              Document Q&A is not available yet. Your documents are unchanged; please try again later.
            </p>
          )}
          {error && !featureDisabled && (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}

          {answer && (
            <div className="mt-5 space-y-4" aria-live="polite">
              {answer.status === "no_evidence" ? (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <h3 className="text-sm font-semibold text-amber-100">No matching passages</h3>
                  <p className="mt-1 text-sm text-amber-100/80">
                    No evidence was found in the selected scope. Confirm that the documents finished processing and try a more specific question.
                  </p>
                </div>
              ) : answer.status === "insufficient_evidence" ? (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                  <h3 className="text-sm font-semibold text-amber-100">Not enough evidence</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{answer.answer}</p>
                  <p className="mt-2 text-xs text-slate-400">No sources were returned, so no citations are shown.</p>
                </div>
              ) : (
                <article className="rounded-xl border border-emerald-500/20 bg-slate-950/40 p-4">
                  <h3 className="text-sm font-semibold text-emerald-200">Answer</h3>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-100">{answer.answer}</p>
                  {answer.sources.length > 0 && (
                    <div className="mt-5 border-t border-slate-800 pt-4">
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                        <BookOpenText className="h-4 w-4 text-indigo-300" /> Sources
                      </h4>
                      <ul className="space-y-2">
                        {answer.sources.map(source => (
                          <li key={source.chunkId} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                            <p className="break-words text-sm font-medium text-indigo-100">{source.documentName}</p>
                            <p className="mt-1 text-xs leading-relaxed text-slate-400">
                              {source.pageStart !== null
                                ? `Page ${source.pageStart}${source.pageEnd !== null && source.pageEnd !== source.pageStart ? `–${source.pageEnd}` : ""}`
                                : "Page unavailable"}
                              {source.sectionPath?.length ? ` · ${source.sectionPath.join(" › ")}` : ""}
                              {` · Chunk ${source.chunkIndex + 1} · Source characters ${source.sourceStart}–${source.sourceEnd}`}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
