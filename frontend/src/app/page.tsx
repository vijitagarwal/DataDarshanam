"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Sidebar } from "@/components/Sidebar";
import { HeroState } from "@/components/HeroState";
import { QueryResult } from "@/components/QueryResult";
import { DashboardView } from "@/components/DashboardView";
import { ChatInputBar } from "@/components/ChatInputBar";
import { fetchSchema, postQuery, postDashboardQuery, uploadCSVFile } from "@/lib/api";
import { SchemaResponse, ChatEntry, SavedChart } from "@/lib/types";
import { Database, Trash2, Layers, Menu } from "lucide-react";

export default function Home() {
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([]);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [datasetName, setDatasetName] = useState("sales.csv");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Load dataset schema on initial mount
  useEffect(() => {
    fetchSchema()
      .then((data) => {
        setSchema(data);
        setSchemaError(null);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unable to connect to the backend API.";
        console.error("Error fetching schema:", err);
        setSchemaError(message);
      });
  }, []);

  // Handle natural query execution
  const handleSendQuery = useCallback(async (queryStr: string) => {
    if (!queryStr.trim() || isLoading) return;

    const entryId = `entry-${Date.now()}`;
    const newEntry: ChatEntry = {
      id: entryId,
      type: "query",
      query: queryStr,
      isLoading: true,
    };

    setChatEntries((prev) => [...prev, newEntry]);
    setIsLoading(true);

    // Get previous context from last successful query if available
    let previousContext = undefined;
    const lastEntry = chatEntries[chatEntries.length - 1];
    if (lastEntry?.response?.parsed && !lastEntry.response.error) {
      previousContext = lastEntry.response.parsed;
    }

    try {
      // Check if user requested a full dashboard
      const isDashboard = queryStr.toLowerCase().includes("dashboard") || queryStr.toLowerCase().includes("overview");

      if (isDashboard) {
        const dashRes = await postDashboardQuery(queryStr);
        setChatEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { ...e, type: "dashboard", dashboardResponse: dashRes, isLoading: false }
              : e
          )
        );
      } else {
        const queryRes = await postQuery(queryStr, previousContext);
        setChatEntries((prev) =>
          prev.map((e) =>
            e.id === entryId
              ? { ...e, response: queryRes, isLoading: false }
              : e
          )
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to process query";
      setChatEntries((prev) =>
        prev.map((e) =>
          e.id === entryId
            ? {
                ...e,
                isLoading: false,
                response: {
                  success: false,
                  error: true,
                  query: queryStr,
                  insight: message,
                  message,
                },
              }
            : e
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [chatEntries, isLoading]);

  // Generate full dashboard button handler
  const handleGenerateDashboard = () => {
    handleSendQuery("generate full dashboard overview");
  };

  // Clear chat handler
  const handleNewChat = () => {
    setChatEntries([]);
  };

  // Save chart handler
  const handleSaveChart = (savedItem: SavedChart) => {
    setSavedCharts((prev) => {
      if (prev.some((s) => s.query === savedItem.query)) return prev;
      return [...prev, savedItem];
    });
  };

  // Remove saved chart handler
  const handleRemoveSavedChart = (id: string) => {
    setSavedCharts((prev) => prev.filter((s) => s.id !== id));
  };

  // CSV upload handler
  const handleUploadCSV = async (file: File) => {
    setIsUploading(true);
    try {
      const newSchema = await uploadCSVFile(file);
      setSchema(newSchema);
      setDatasetName(newSchema.filename);
      setSchemaError(null);
      setChatEntries([]);
      setSavedCharts([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unable to upload CSV.";
      setSchemaError(message);
      alert(`Upload failed: ${message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const isChatEmpty = chatEntries.length === 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0a0d14]">
      {/* Left Sidebar */}
      <Sidebar
        profile={schema?.profile}
        schemaError={schemaError}
        savedCharts={savedCharts}
        chatEntries={chatEntries}
        onNewChat={handleNewChat}
        onSelectQuery={(q) => handleSendQuery(q)}
        onRestoreSaved={(response) => {
          if (!response) return;
          setChatEntries((prev) => [...prev, { id: `restored-${Date.now()}`, type: "query", query: response.query, response }]);
        }}
        onRemoveSavedChart={handleRemoveSavedChart}
        onUploadCSV={handleUploadCSV}
        isUploading={isUploading}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#0d1117] relative">
        {/* Top Header Bar */}
        <header className="h-14 border-b border-indigo-500/10 px-4 md:px-6 flex items-center justify-between shrink-0 bg-[#0d1117]/80 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsSidebarOpen(true)} aria-label="Open navigation" className="p-1.5 text-slate-400 hover:text-white md:hidden">
              <Menu className="w-5 h-5" />
            </button>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
              <Database className="w-3.5 h-3.5 text-indigo-400" />
              <span>{datasetName} ({schema?.profile?.rows?.toLocaleString() || "—"} rows)</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {!isChatEmpty && (
              <>
                <button
                  onClick={handleGenerateDashboard}
                  className="btn-primary text-xs px-3 py-1.5 inline-flex items-center gap-1.5"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Full Dashboard</span>
                </button>

                <button
                  onClick={handleNewChat}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 border border-indigo-500/10 transition-colors text-xs flex items-center gap-1"
                  title="Clear Chat"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Scrollable Conversation Workspace */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {isChatEmpty ? (
            <HeroState
              suggestedQuestions={schema?.suggested_questions}
              onSelectQuestion={handleSendQuery}
              onGenerateDashboard={handleGenerateDashboard}
            />
          ) : (
            <div className="max-w-5xl mx-auto space-y-8">
              {chatEntries.map((entry, idx) => {
                if (entry.isLoading) {
                  return (
                    <div key={entry.id} className="w-full space-y-3 animate-pulse">
                      <div className="flex justify-end">
                        <div className="bg-indigo-600/30 text-indigo-200 px-4 py-2 rounded-xl text-sm font-medium">
                          {entry.query}
                        </div>
                      </div>
                      <div className="glass-card p-6 flex flex-col gap-3">
                        <div className="h-4 w-48 skeleton-shimmer" />
                        <div className="h-64 w-full skeleton-shimmer" />
                      </div>
                    </div>
                  );
                }

                if (entry.type === "dashboard" && entry.dashboardResponse) {
                  return <DashboardView key={entry.id} response={entry.dashboardResponse} />;
                }

                if (entry.response) {
                  return (
                    <QueryResult
                      key={entry.id}
                      entryIndex={idx}
                      response={entry.response}
                      onSaveChart={handleSaveChart}
                      isSaved={savedCharts.some((s) => s.query === entry.query)}
                    />
                  );
                }

                return null;
              })}
            </div>
          )}
        </div>

        {/* Sticky Floating Chat Input */}
        <ChatInputBar
          onSend={handleSendQuery}
          isLoading={isLoading}
          suggestedQuestions={schema?.suggested_questions}
        />
      </main>
    </div>
  );
}
