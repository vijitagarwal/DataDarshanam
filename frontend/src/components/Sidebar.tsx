"use client";

import React, { useState, useRef } from "react";
import { DatasetProfile, SavedChart, ChatEntry } from "@/lib/types";
import {
  Plus,
  MessageSquare,
  Database,
  Bookmark,
  HelpCircle,
  Upload,
  Trash2,
  Download,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";

interface SidebarProps {
  profile?: DatasetProfile;
  schemaError?: string | null;
  savedCharts: SavedChart[];
  chatEntries: ChatEntry[];
  onNewChat: () => void;
  onSelectQuery: (query: string) => void;
  onRestoreSaved: (response: SavedChart["response"]) => void;
  onRemoveSavedChart: (id: string) => void;
  onUploadCSV: (file: File) => void;
  isUploading?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  profile,
  schemaError,
  savedCharts,
  chatEntries,
  onNewChat,
  onSelectQuery,
  onRestoreSaved,
  onRemoveSavedChart,
  onUploadCSV,
  isUploading = false,
  isOpen = false,
  onClose,
}) => {
  const [showColumnsDetail, setShowColumnsDetail] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUploadCSV(e.target.files[0]);
    }
  };

  // Export saved insights as HTML file download
  const handleExportHTML = () => {
    if (!savedCharts || savedCharts.length === 0) return;
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>dataदर्शनम् — Saved Insights</title>`;
    html += `<style>body{font-family:Inter,sans-serif;background:#0a0d14;color:#f8fafc;padding:2rem;max-width:800px;margin:0 auto;}` +
      `h1{color:#6366f1;border-bottom:1px solid #1e293b;padding-bottom:0.5rem;}` +
      `.card{background:#141b2d;border:1px solid #1e293b;border-radius:12px;padding:1.2rem;margin-bottom:1.5rem;}` +
      `.q{color:#a5b4fc;font-size:1.1rem;font-weight:700;margin-bottom:0.5rem;}` +
      `.insight{color:#94a3b8;line-height:1.6;font-size:0.95rem;}` +
      `.stats{font-size:0.8rem;color:#10b981;margin-top:0.5rem;font-weight:600;}</style></head><body>`;
    html += `<h1>📊 dataदर्शनम् — Saved Insights Report</h1>`;
    savedCharts.forEach((sc) => {
      html += `<div class="card"><div class="q">${sc.query}</div><div class="insight">💡 ${sc.insight}</div>`;
      if (sc.summary) {
        html += `<div class="stats">Total: ${sc.summary.total?.toLocaleString() || "—"} | Top: ${sc.summary.max_label || "—"} (${sc.summary.max_value?.toLocaleString() || "—"})</div>`;
      }
      html += `</div>`;
    });
    html += `</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "datadarshanam_saved_insights.html";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      {isOpen && <button aria-label="Close navigation" onClick={onClose} className="fixed inset-0 z-30 bg-black/60 md:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 w-72 bg-[#0d1117] border-r border-indigo-500/10 flex flex-col h-screen shrink-0 text-slate-200 select-none transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}>
      {/* Brand Header */}
      <div className="p-4 border-b border-indigo-500/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-500/30">
            📊
          </div>
          <button onClick={onClose} aria-label="Close navigation" className="p-1.5 text-slate-400 hover:text-white md:hidden">
            <X className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white leading-none">
              data<span className="text-gradient-devanagari ml-0.5">दर्शनम्</span>
            </h1>
            <span className="text-[10px] text-slate-400 font-medium">Conversational BI</span>
          </div>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full btn-primary py-2.5 px-3 flex items-center justify-center gap-2 text-xs"
        >
          <Plus className="w-4 h-4" />
          <span>New Query Chat</span>
        </button>
      </div>

      {/* Scrollable Sidebar Content */}
      <div className="flex-1 overflow-y-auto px-3 space-y-5 text-xs">
        {/* Past Queries List */}
        {chatEntries.length > 0 && (
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-1 flex items-center gap-1.5">
              <MessageSquare className="w-3 h-3 text-indigo-400" />
              <span>Query History ({chatEntries.length})</span>
            </div>
            <div className="space-y-1">
              {chatEntries.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => onSelectQuery(entry.query)}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-800/60 text-slate-300 hover:text-white truncate transition-colors flex items-center gap-2 group"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 group-hover:scale-125 transition-transform" />
                  <span className="truncate">{entry.query}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dataset Profile */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-1 flex items-center gap-1.5">
            <Database className="w-3 h-3 text-indigo-400" />
            <span>Dataset Profile</span>
          </div>

          <div className="glass-card p-3 space-y-2">
            {schemaError ? (
              <div className="flex items-start gap-2 text-red-300 leading-relaxed">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{schemaError}</span>
              </div>
            ) : profile ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-100 text-xs">
                    {profile.rows.toLocaleString()} Rows
                  </span>
                  <span className="text-[11px] text-indigo-400 font-semibold">
                    {profile.column_count} Cols
                  </span>
                </div>

                {/* Column Pills */}
                {profile.numeric_columns?.length > 0 && (
                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Metrics ({profile.numeric_columns.length}):
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {profile.numeric_columns.slice(0, 4).map((c) => (
                        <span key={c} className="pill-chip text-[10px] py-0 px-1.5">
                          📊 {c.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {profile.categorical_columns?.length > 0 && (
                  <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Dimensions ({profile.categorical_columns.length}):
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {profile.categorical_columns.slice(0, 4).map((c) => (
                        <span key={c} className="pill-chip text-[10px] py-0 px-1.5">
                          🏷️ {c.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expand All Columns Detail */}
                <button
                  onClick={() => setShowColumnsDetail(!showColumnsDetail)}
                  className="w-full pt-1 flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 border-t border-indigo-500/10 mt-2"
                >
                  <span>All Columns Schema</span>
                  {showColumnsDetail ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>

                {showColumnsDetail && (
                  <div className="space-y-1.5 pt-1 max-h-36 overflow-y-auto">
                    {profile.columns.map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] text-slate-300">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="text-[10px] text-indigo-400 font-mono">{c.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-slate-400 text-[11px]">Loading dataset schema...</div>
            )}

            {/* CSV Upload Button */}
            <input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full mt-2 py-1.5 px-2.5 rounded-lg border border-dashed border-indigo-500/30 hover:border-indigo-500 text-indigo-300 hover:bg-indigo-500/10 transition-all flex items-center justify-center gap-1.5 text-xs font-semibold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{isUploading ? "Uploading..." : "Upload Custom CSV"}</span>
            </button>
          </div>
        </div>

        {/* Saved Charts Panel */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 px-1 flex items-center gap-1.5">
            <Bookmark className="w-3 h-3 text-indigo-400" />
            <span>Saved Charts ({savedCharts.length})</span>
          </div>

          {savedCharts.length === 0 ? (
            <div className="glass-card p-3 text-[11px] text-slate-400 text-center">
              Pin any chart using 📌 Save Chart button.
            </div>
          ) : (
            <div className="space-y-2">
              {savedCharts.map((sc) => (
                <div key={sc.id} className="glass-card p-2.5 flex items-start justify-between gap-2 group">
                  <button
                    onClick={() => sc.response && onRestoreSaved(sc.response)}
                    disabled={!sc.response}
                    className="text-left flex-1 text-xs font-medium text-slate-200 group-hover:text-indigo-300 truncate"
                  >
                    📌 {sc.query}
                  </button>
                  <button
                    onClick={() => onRemoveSavedChart(sc.id)}
                    className="text-slate-500 hover:text-red-400 p-0.5 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}

              <button
                onClick={handleExportHTML}
                className="w-full py-1.5 px-2 rounded-lg text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Insights HTML</span>
              </button>
            </div>
          )}
        </div>

        {/* How It Works Expander */}
        <div>
          <button
            onClick={() => setShowHowItWorks(!showHowItWorks)}
            className="w-full text-left text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 flex items-center justify-between py-1 hover:text-slate-200"
          >
            <span className="flex items-center gap-1.5">
              <HelpCircle className="w-3 h-3 text-indigo-400" />
              <span>How It Works</span>
            </span>
            {showHowItWorks ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showHowItWorks && (
            <div className="glass-card p-3 space-y-2 mt-1 text-[11px] text-slate-300">
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-[9px] shrink-0 mt-0.5">1</span>
                <div><strong>Natural Query:</strong> Plain English inputparsed via LLaMA 3 70B.</div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-[9px] shrink-0 mt-0.5">2</span>
                <div><strong>Pandas Engine:</strong> Aggregates metrics & dimensions in memory.</div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-[9px] shrink-0 mt-0.5">3</span>
                <div><strong>Plotly Visuals:</strong> Dynamic specs render interactive charts.</div>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-indigo-600 text-white font-bold flex items-center justify-center text-[9px] shrink-0 mt-0.5">4</span>
                <div><strong>AI Insight:</strong> Concise business takeaways generated automatically.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer info */}
      <div className="p-3 border-t border-indigo-500/10 text-center text-[10px] text-slate-400">
        Groq LLaMA 3 70B · Plotly · Pandas
      </div>
      </aside>
    </>
  );
};
