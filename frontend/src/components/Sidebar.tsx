"use client";

import React, { useEffect, useRef } from "react";
import type { DatasetProfile, DatasetSummary, ChatEntry } from "@/lib/types";
import { AlertCircle, Database, FileSpreadsheet, Trash2, X } from "lucide-react";

export type WorkspacePanel = "dataset" | "history" | null;

interface SidebarProps {
  panel: WorkspacePanel;
  profile?: DatasetProfile;
  datasetName: string;
  datasetMode: "demo" | "custom";
  selectedDatasetId?: string | null;
  datasets?: DatasetSummary[];
  isSignedIn?: boolean;
  datasetsLoading?: boolean;
  datasetsError?: string | null;
  schemaError?: string | null;
  chatEntries: ChatEntry[];
  onSelectEntry: (entryId: string) => void;
  onUploadCSV: (file: File) => void;
  onSelectDataset: (dataset: DatasetSummary) => void;
  onDeleteDataset: (dataset: DatasetSummary) => void;
  onSelectDemoDataset: () => void;
  isUploading?: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  panel,
  profile,
  datasetName,
  datasetMode,
  selectedDatasetId,
  datasets = [],
  isSignedIn = false,
  datasetsLoading = false,
  datasetsError,
  schemaError,
  chatEntries,
  onSelectEntry,
  onUploadCSV,
  onSelectDataset,
  onDeleteDataset,
  onSelectDemoDataset,
  isUploading = false,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (panel && !dialog.open) dialog.showModal();
    if (!panel && dialog.open) dialog.close();
  }, [panel]);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onUploadCSV(file);
    event.target.value = "";
  }

  return (
    <dialog
      ref={dialogRef}
      className="ledger-sheet"
      aria-labelledby="workspace-panel-heading"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className="ledger-sheet-header">
        <div>
          <p className="ledger-kicker">Workspace</p>
          <h2 id="workspace-panel-heading">{panel === "history" ? "Question history" : "Dataset details"}</h2>
        </div>
        <button type="button" className="ledger-icon-button" onClick={onClose} aria-label="Close panel">
          <X size={19} aria-hidden="true" />
        </button>
      </div>

      {panel === "history" ? (
        <section aria-label="Previous questions">
          {chatEntries.length === 0 ? (
            <p className="ledger-empty-note">Questions you ask in this workspace will appear here.</p>
          ) : (
            <ol className="ledger-history-list">
              {[...chatEntries].reverse().map((entry) => (
                <li key={entry.id}>
                  <button type="button" onClick={() => onSelectEntry(entry.id)}>
                    <span>{entry.query}</span>
                    <small>{entry.isLoading ? "Running" : entry.response?.error ? "Needs attention" : "Question"}</small>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : (
        <section aria-label="Selected dataset information">
          <div className="ledger-dataset-summary">
            <Database size={18} aria-hidden="true" />
            <div>
              <strong>{datasetName || "No dataset selected"}</strong>
              <span>{profile ? `${profile.rows.toLocaleString()} rows · ${profile.column_count} columns` : "Dataset profile unavailable"}</span>
            </div>
          </div>
          <p className="ledger-muted">
            {datasetMode === "demo"
              ? "The bundled demo dataset is selected."
              : selectedDatasetId
                ? "This CSV is stored privately in your signed-in account."
                : "No custom dataset is selected. Choose a saved CSV, upload one, or explicitly select the demo dataset."}
          </p>
          {schemaError && (
            <p className="ledger-message ledger-message-error" role="alert">
              <AlertCircle size={16} aria-hidden="true" /> {schemaError}
            </p>
          )}
          {profile && (
            <>
              <div className="ledger-profile-groups">
                <div><span>Numeric fields</span><strong>{profile.numeric_columns.length}</strong></div>
                <div><span>Categories</span><strong>{profile.categorical_columns.length}</strong></div>
                <div><span>Date fields</span><strong>{profile.date_columns.length}</strong></div>
              </div>
              <h3 className="ledger-subheading">Schema</h3>
              <div className="ledger-schema-scroll" role="region" aria-label="Dataset schema" tabIndex={0}>
                <table className="ledger-schema-table">
                  <thead><tr><th scope="col">Column</th><th scope="col">Role</th><th scope="col">Type</th></tr></thead>
                  <tbody>
                    {profile.columns.map((column) => (
                      <tr key={column.name}>
                        <td>{column.name}</td><td>{column.role}</td><td>{column.dtype}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {isSignedIn && (
            <div className="mt-5">
              <h3 className="ledger-subheading">Your saved datasets</h3>
              {datasetsLoading ? (
                <p className="ledger-empty-note" role="status">Loading saved datasets…</p>
              ) : datasets.length === 0 ? (
                <p className="ledger-empty-note">No CSV datasets are saved to this account yet.</p>
              ) : (
                <ul className="space-y-2">
                  {datasets.map((dataset) => (
                    <li key={dataset.id} className="flex items-center gap-2">
                      <button
                        type="button"
                        className="ledger-button min-w-0 flex-1 text-left"
                        aria-current={selectedDatasetId === dataset.id ? "true" : undefined}
                        disabled={dataset.status !== "ready"}
                        onClick={() => onSelectDataset(dataset)}
                      >
                        <span className="block truncate">{dataset.original_filename}</span>
                        <small className="block">
                          {dataset.status === "ready"
                            ? `${dataset.row_count.toLocaleString()} rows · ${dataset.column_count} columns`
                            : dataset.status === "uploading"
                              ? "Upload interrupted · delete to retry"
                              : dataset.status === "deleting"
                                ? "Deletion pending · retry delete"
                                : "Upload failed · delete to remove"}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="ledger-icon-button"
                        onClick={() => onDeleteDataset(dataset)}
                        aria-label={`Delete ${dataset.original_filename}`}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {datasetsError && (
                <p className="ledger-message ledger-message-error mt-3" role="alert">
                  <AlertCircle size={16} aria-hidden="true" /> {datasetsError}
                </p>
              )}
            </div>
          )}
          <div className="ledger-dataset-actions">
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={handleFileChange} />
            <button type="button" className="ledger-button ledger-button-primary" onClick={() => fileInputRef.current?.click()} disabled={isUploading || !isSignedIn}>
              <FileSpreadsheet size={16} aria-hidden="true" />
              {isUploading ? "Uploading CSV…" : "Upload custom CSV"}
            </button>
            <button type="button" className="ledger-button" onClick={onSelectDemoDataset} disabled={isUploading}>
              Select demo dataset
            </button>
            {!isSignedIn && <p className="ledger-caption">Sign in with an existing account to save private CSV datasets.</p>}
            <p className="ledger-caption">CSV files are private to your account. Each file is limited to 25 MB, 250,000 rows, and 100 columns.</p>
          </div>
        </section>
      )}
      <button type="button" className="ledger-text-button ledger-sheet-dismiss" onClick={onClose}>Close panel</button>
    </dialog>
  );
};
