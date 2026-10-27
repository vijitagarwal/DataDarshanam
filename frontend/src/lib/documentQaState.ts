import type { DocumentItem } from "./documentApi";

export function toggleSelectedDocument(
  selectedIds: readonly string[],
  documentId: string,
): string[] {
  return selectedIds.includes(documentId)
    ? selectedIds.filter(id => id !== documentId)
    : [...selectedIds, documentId];
}

export function resolveDocumentScope(
  readyDocuments: readonly DocumentItem[],
  selectedIds: readonly string[],
): string[] | undefined {
  if (selectedIds.length === 0) return undefined;
  const readyIds = new Set(readyDocuments
    .filter(document => document.status === "ready")
    .map(document => document.id));
  return selectedIds.filter(id => readyIds.has(id));
}

export interface SubmissionLock {
  active: boolean;
}

export function acquireSubmission(lock: SubmissionLock): boolean {
  if (lock.active) return false;
  lock.active = true;
  return true;
}

export function releaseSubmission(lock: SubmissionLock): void {
  lock.active = false;
}
