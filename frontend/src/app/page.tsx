"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Database, History, Moon, Sun } from "lucide-react";
import { AuthControl } from "@/components/AuthControl";
import { BrandLockup } from "@/components/BrandLockup";
import { ChatInputBar } from "@/components/ChatInputBar";
import { DashboardView } from "@/components/DashboardView";
import { DocumentManager } from "@/components/DocumentManager";
import { DocumentQaPanel } from "@/components/DocumentQaPanel";
import { HeroState } from "@/components/HeroState";
import { QueryResult } from "@/components/QueryResult";
import { SavedChartsView } from "@/components/SavedChartsView";
import { Sidebar, type WorkspacePanel } from "@/components/Sidebar";
import {
  clearCustomDatasetSelection,
  deleteUserDataset,
  fetchSchema,
  fetchUserDatasets,
  getSelectedDatasetName,
  postDashboardQuery,
  postQuery,
  selectCustomDataset,
  selectDemoDataset,
  uploadCSVFile,
} from "@/lib/api";
import type { ChatEntry, DatasetSummary, SavedChart, SchemaResponse } from "@/lib/types";
import type { DocumentItem } from "@/lib/documentApi";

type ViewName = "analyze" | "documents" | "charts";

const navigation: { id: ViewName; label: string }[] = [
  { id: "analyze", label: "Analyze" },
  { id: "documents", label: "Documents" },
  { id: "charts", label: "Charts" },
];

export default function Home() {
  const [activeView, setActiveView] = useState<ViewName>("analyze");
  const [openPanel, setOpenPanel] = useState<WorkspacePanel>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("sales.csv");
  const [datasetMode, setDatasetMode] = useState<"demo" | "custom">("demo");
  const [questionDraft, setQuestionDraft] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const [darkTheme, setDarkTheme] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [savedDatasets, setSavedDatasets] = useState<DatasetSummary[]>([]);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);

  const refreshDatasets = useCallback(async () => {
    setDatasetsLoading(true);
    setDatasetsError(null);
    try {
      setSavedDatasets(await fetchUserDatasets());
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "Unable to load saved datasets.";
      setDatasetsError(message);
    } finally {
      setDatasetsLoading(false);
    }
  }, []);

  const handleAuthenticationChange = useCallback((signedIn: boolean) => {
    setIsSignedIn(signedIn);
    if (!signedIn) {
      setSavedDatasets([]);
      if (window.localStorage.getItem("datadarshan-dataset-mode") === "custom") {
        setSchema(null);
        setSchemaError("Sign in to access your private CSV dataset.");
        clearCustomDatasetSelection();
        selectDemoDataset();
        setDatasetMode("demo");
        setSelectedDatasetId(null);
        setDatasetName("sales.csv");
        setChatEntries([]);
        setSavedCharts([]);
        setStatusMessage("Authentication ended. Demo dataset restored.");
      }
      return;
    }

    void refreshDatasets();
    if (window.localStorage.getItem("datadarshan-dataset-mode") === "custom") {
      const storedDatasetId = window.localStorage.getItem("datadarshan-dataset-id");
      setSelectedDatasetId(storedDatasetId);
      setDatasetName(getSelectedDatasetName() ?? "Custom CSV");
      void fetchSchema()
        .then((data) => {
          setSchema(data);
          setSchemaError(null);
          setDatasetName(data.filename ?? getSelectedDatasetName() ?? "Custom CSV");
        })
        .catch((reason: unknown) => {
          const message = reason instanceof Error ? reason.message : "Unable to load the selected dataset.";
          setSchema(null);
          setSchemaError(message);
          clearCustomDatasetSelection();
          setSelectedDatasetId(null);
          setDatasetName("");
          selectDemoDataset();
          setDatasetMode("demo");
          setStatusMessage("The saved dataset is unavailable. Demo dataset restored.");
        });
    }
  }, [refreshDatasets]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("datadarshan-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDarkTheme(storedTheme ? storedTheme === "dark" : prefersDark);

    const storedMode = window.localStorage.getItem("datadarshan-dataset-mode");
    const storedDatasetId = window.localStorage.getItem("datadarshan-dataset-id");
    const legacyWorkspace = window.localStorage.getItem("datadarshan-workspace-id");
    if (storedMode === "custom" || (!storedMode && (legacyWorkspace || storedDatasetId))) {
      setDatasetMode("custom");
      setSelectedDatasetId(storedDatasetId);
      setDatasetName(getSelectedDatasetName() ?? "Custom CSV");
    }

    let active = true;
    fetchSchema()
      .then((data) => {
        if (!active) return;
        setSchema(data);
        setSchemaError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        const message = reason instanceof Error ? reason.message : "Unable to connect to the data service.";
        setSchemaError(message);
        setStatusMessage(message);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = darkTheme ? "dark" : "light";
    window.localStorage.setItem("datadarshan-theme", darkTheme ? "dark" : "light");
  }, [darkTheme]);

  const handleSendQuery = useCallback(async (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || isLoading) return;
    if (!schema) {
      setStatusMessage(schemaError ?? "Choose a dataset and wait for its schema before asking a question.");
      return;
    }

    const entryId = `entry-${Date.now()}`;
    setChatEntries((entries) => [...entries, {
      id: entryId,
      type: "query",
      query: normalizedQuery,
      isLoading: true,
    }]);
    setStatusMessage(`Working on: ${normalizedQuery}`);
    setIsLoading(true);

    const lastEntry = chatEntries[chatEntries.length - 1];
    const previousContext = lastEntry?.response?.result && !lastEntry.response.error
      ? lastEntry.response.result
      : undefined;

    try {
      const isDashboard = /dashboard|overview/i.test(normalizedQuery);
      if (isDashboard) {
        const response = await postDashboardQuery(normalizedQuery);
        setChatEntries((entries) => entries.map((entry) => entry.id === entryId
          ? { ...entry, type: "dashboard", dashboardResponse: response, isLoading: false }
          : entry));
      } else {
        const response = await postQuery(normalizedQuery, previousContext);
        setChatEntries((entries) => entries.map((entry) => entry.id === entryId
          ? { ...entry, response, isLoading: false }
          : entry));
      }
      setStatusMessage("Question finished.");
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "The question could not be completed.";
      setChatEntries((entries) => entries.map((entry) => entry.id === entryId
        ? {
            ...entry,
            isLoading: false,
            response: {
              success: false,
              error: true,
              query: normalizedQuery,
              insight: message,
              message,
            },
          }
        : entry));
      setStatusMessage(`Question failed: ${message}`);
    } finally {
      setIsLoading(false);
      window.setTimeout(() => {
        document.getElementById(entryId)?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
          block: "start",
        });
      }, 0);
    }
  }, [chatEntries, isLoading, schema, schemaError]);

  const handleGenerateDashboard = () => handleSendQuery("generate full dashboard overview");

  function handleNewChat() {
    if (!chatEntries.length) return;
    if (!window.confirm("Clear all questions and results from this workspace? Saved charts will remain.")) return;
    setChatEntries([]);
    setStatusMessage("Question history cleared.");
  }

  function handleSaveChart(chart: SavedChart) {
    setSavedCharts((charts) => charts.some((saved) => saved.query === chart.query)
      ? charts
      : [...charts, chart]);
    setStatusMessage("Chart saved in this browser session.");
  }

  function handleDeleteSavedChart(chart: SavedChart) {
    if (!window.confirm(`Delete the saved chart “${chart.query}”?`)) return;
    setSavedCharts((charts) => charts.filter((saved) => saved.id !== chart.id));
    setStatusMessage("Saved chart deleted.");
  }

  function handleOpenSavedChart(chart: SavedChart) {
    if (!chart.response) return;
    const response = chart.response;
    const id = `restored-${Date.now()}`;
    setChatEntries((entries) => [...entries, {
      id,
      type: "query",
      query: response.query,
      response,
    }]);
    setActiveView("analyze");
    setStatusMessage("Saved result opened in Analyze.");
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 0);
  }

  async function handleUploadCSV(file: File) {
    setIsUploading(true);
    setSchemaError(null);
    setStatusMessage(`Uploading ${file.name}…`);
    try {
      const newSchema = await uploadCSVFile(file);
      setSchema(newSchema);
      setDatasetName(newSchema.filename);
      setDatasetMode("custom");
      setSelectedDatasetId(newSchema.dataset_id);
      setChatEntries([]);
      setSavedCharts([]);
      setOpenPanel(null);
      await refreshDatasets();
      setStatusMessage(`${file.name} uploaded. Its schema is ready for questions.`);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "Unable to upload this CSV.";
      setSchemaError(message);
      setStatusMessage(`CSV upload failed: ${message}`);
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSelectDataset(dataset: DatasetSummary) {
    setSchema(null);
    setSchemaError(null);
    setStatusMessage(`Loading ${dataset.original_filename}…`);
    try {
      const selectedSchema = await fetchSchema(dataset.id);
      selectCustomDataset(dataset.id, dataset.original_filename);
      setSelectedDatasetId(dataset.id);
      setDatasetMode("custom");
      setDatasetName(dataset.original_filename);
      setSchema(selectedSchema);
      setSchemaError(null);
      setChatEntries([]);
      setSavedCharts([]);
      setStatusMessage(`${dataset.original_filename} selected.`);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "Unable to load this saved dataset.";
      setSchemaError(message);
      clearCustomDatasetSelection();
      selectDemoDataset();
      setSelectedDatasetId(null);
      setDatasetMode("demo");
      setDatasetName("sales.csv");
      setStatusMessage(`${message} Demo dataset restored.`);
      void fetchSchema()
        .then((demoSchema) => setSchema(demoSchema))
        .catch(() => undefined);
    }
  }

  async function handleDeleteDataset(dataset: DatasetSummary) {
    if (!window.confirm(`Permanently delete ${dataset.original_filename} and its stored CSV?`)) return;
    try {
      await deleteUserDataset(dataset.id);
      setSavedDatasets((items) => items.filter((item) => item.id !== dataset.id));
      if (selectedDatasetId === dataset.id) {
        clearCustomDatasetSelection();
        setSelectedDatasetId(null);
        setDatasetName("");
        setSchema(null);
        setSchemaError("The selected dataset was deleted. Choose another dataset or explicitly select the demo dataset.");
        setChatEntries([]);
        setSavedCharts([]);
      }
      setStatusMessage(`${dataset.original_filename} deleted.`);
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "Unable to delete this dataset.";
      setDatasetsError(message);
      setStatusMessage(message);
    }
  }

  async function handleSelectDemoDataset() {
    selectDemoDataset();
    setDatasetMode("demo");
    setSelectedDatasetId(null);
    setDatasetName("sales.csv");
    setSchemaError(null);
    setStatusMessage("Loading the bundled demo dataset…");
    try {
      const demoSchema = await fetchSchema();
      setSchema(demoSchema);
      setChatEntries([]);
      setSavedCharts([]);
      setOpenPanel(null);
      setStatusMessage("Demo dataset selected.");
    } catch (reason: unknown) {
      const message = reason instanceof Error ? reason.message : "Unable to load the demo dataset.";
      setSchema(null);
      setSchemaError(message);
      setStatusMessage(message);
    }
  }

  function focusHistoryEntry(entryId: string) {
    setOpenPanel(null);
    setActiveView("analyze");
    window.setTimeout(() => document.getElementById(entryId)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "start",
    }), 0);
  }

  const isChatEmpty = chatEntries.length === 0;
  const selectedNavigation = navigation.find((item) => item.id === activeView);

  return (
    <div className="ledger-app">
      <a className="ledger-skip-link" href="#main-content">Skip to content</a>
      <header className="ledger-header">
        <div className="ledger-header-row">
          <a className="ledger-brand-link" href="#main-content" aria-label="DataDarshanam home">
            <BrandLockup isDark={darkTheme} responsive />
          </a>
          <nav className="ledger-navigation" aria-label="Primary">
            {navigation.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => setActiveView(item.id)}
              >
                {item.label}{item.id === "charts" && savedCharts.length > 0 ? ` (${savedCharts.length})` : ""}
              </button>
            ))}
          </nav>
          <div className="ledger-header-tools">
            <button type="button" className="ledger-button ledger-header-button" onClick={() => setOpenPanel("dataset")}>
              <Database size={16} aria-hidden="true" /><span className="ledger-tool-label">Dataset</span>
            </button>
            <button type="button" className="ledger-button ledger-header-button" onClick={() => setOpenPanel("history")}>
              <History size={16} aria-hidden="true" /><span className="ledger-tool-label">History</span>
              {chatEntries.length > 0 && <span className="ledger-count">{chatEntries.length}</span>}
            </button>
            <button
              type="button"
              className="ledger-icon-button"
              onClick={() => setDarkTheme((value) => !value)}
              aria-label={`Switch to ${darkTheme ? "light" : "dark"} theme`}
              title={`Switch to ${darkTheme ? "light" : "dark"} theme`}
            >
              {darkTheme ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
            </button>
            <AuthControl isDark={darkTheme} onAuthenticationChange={handleAuthenticationChange} />
          </div>
        </div>
        <div className="ledger-header-meta">
          <span className="ledger-dataset-chip" title={`${datasetName} · ${datasetMode === "demo" ? "Bundled demo dataset" : "Private saved dataset"}`}>
            <span className="ledger-status-dot" aria-hidden="true" />
            {datasetMode === "demo" ? "Demo" : "Custom"} · {datasetName || "No dataset selected"} · {schema?.profile.rows.toLocaleString() ?? "—"} rows
          </span>
          {schemaError && <span className="ledger-inline-error" role="status">{schemaError}</span>}
        </div>
      </header>

      <Sidebar
        panel={openPanel}
        profile={schema?.profile}
        datasetName={datasetName}
        datasetMode={datasetMode}
        selectedDatasetId={selectedDatasetId}
        datasets={savedDatasets}
        isSignedIn={isSignedIn}
        datasetsLoading={datasetsLoading}
        datasetsError={datasetsError}
        schemaError={schemaError}
        chatEntries={chatEntries}
        onSelectEntry={focusHistoryEntry}
        onUploadCSV={handleUploadCSV}
        onSelectDataset={handleSelectDataset}
        onDeleteDataset={handleDeleteDataset}
        onSelectDemoDataset={handleSelectDemoDataset}
        isUploading={isUploading}
        onClose={() => setOpenPanel(null)}
      />

      <main id="main-content" className={`ledger-main ${activeView === "analyze" ? "ledger-main-analyze" : ""}`}>
        <div className="ledger-content">
          {activeView === "analyze" && (
            <>
              <div className="ledger-screen-heading">
                <div>
                  <p className="ledger-kicker">Analyze</p>
                  <h1 className="ledger-page-title">A question, answered with your data.</h1>
                </div>
                <div className="ledger-heading-actions">
                  <button type="button" className="ledger-button" onClick={() => setOpenPanel("history")}>
                    <History size={15} aria-hidden="true" /> History
                  </button>
                  {!isChatEmpty && (
                    <button type="button" className="ledger-button" onClick={handleNewChat}>Clear questions</button>
                  )}
                </div>
              </div>
              {schemaError && (
                <p className="ledger-message ledger-message-error" role="alert">
                  {schemaError} Select the demo dataset or upload a CSV from Dataset details to continue.
                </p>
              )}
              {isChatEmpty ? (
                <HeroState
                  suggestedQuestions={schema?.suggested_questions}
                  onSelectQuestion={handleSendQuery}
                  onGenerateDashboard={handleGenerateDashboard}
                />
              ) : (
                <div className="ledger-results" aria-label="Question results">
                  {chatEntries.map((entry, index) => {
                    if (entry.isLoading) {
                      return (
                        <article id={entry.id} className="ledger-result" key={entry.id} aria-label={`Question: ${entry.query}`}>
                          <p className="ledger-question">{entry.query}</p>
                          <div className="ledger-loading" role="status" aria-live="polite">
                            <span className="ledger-loading-indicator" aria-hidden="true" />
                            Preparing your briefing…
                          </div>
                        </article>
                      );
                    }
                    if (entry.type === "dashboard" && entry.dashboardResponse) {
                      return <DashboardView key={entry.id} entryId={entry.id} response={entry.dashboardResponse} isDark={darkTheme} />;
                    }
                    if (entry.response) {
                      return (
                        <QueryResult
                          key={entry.id}
                          entryId={entry.id}
                          entryIndex={index}
                          response={entry.response}
                          onSaveChart={handleSaveChart}
                          isSaved={savedCharts.some((chart) => chart.query === entry.query)}
                          onRetry={handleSendQuery}
                          onEdit={(query) => {
                            setQuestionDraft(query);
                            setFocusRequest((request) => request + 1);
                          }}
                          isDark={darkTheme}
                        />
                      );
                    }
                    return null;
                  })}
                </div>
              )}
            </>
          )}

          {activeView === "charts" && (
            <SavedChartsView charts={savedCharts} onOpen={handleOpenSavedChart} onDelete={handleDeleteSavedChart} />
          )}

          {activeView === "documents" && (
            <section className="ledger-screen" aria-labelledby="documents-heading">
              <p className="ledger-kicker">Private library</p>
              <h1 id="documents-heading" className="ledger-page-title">Documents</h1>
              <p className="ledger-lede">
                Upload and ask questions about documents available to your signed-in account. Answers and citations come from the document service, never from sample passages.
              </p>
              <p className="ledger-private-note">Private document features require authentication. The library and question panel report service configuration and request status directly.</p>
              <DocumentManager
                onDocumentsChange={setDocuments}
                onLoadingChange={setDocumentsLoading}
                onErrorChange={setDocumentsError}
              />
              <DocumentQaPanel documents={documents} documentsLoading={documentsLoading} documentsError={documentsError} />
            </section>
          )}
        </div>
      </main>

      {activeView === "analyze" && (
        <ChatInputBar
          onSend={handleSendQuery}
          isLoading={isLoading}
          suggestedQuestions={schema?.suggested_questions}
          value={questionDraft}
          onChange={setQuestionDraft}
          focusRequest={focusRequest}
        />
      )}
      <p className="ledger-live-region" role="status" aria-live="polite" aria-atomic="true">{statusMessage}</p>
      <span className="sr-only">{selectedNavigation?.label} view</span>
    </div>
  );
}
