"use client";

import React from "react";
import { MessageSquareCode, Zap, Brain, UploadCloud, Sparkles } from "lucide-react";

interface HeroStateProps {
  suggestedQuestions?: string[];
  onSelectQuestion: (q: string) => void;
  onGenerateDashboard: () => void;
}

export const HeroState: React.FC<HeroStateProps> = ({
  suggestedQuestions = [],
  onSelectQuestion,
  onGenerateDashboard,
}) => {
  const defaultQuestions = [
    "Show total revenue by product category",
    "Show monthly sales trends for 2023",
    "What are the top 5 regions by total sales?",
    "Show average rating by category",
    "Count total orders by fulfillment channel",
  ];

  const questionsToDisplay = suggestedQuestions.length > 0 ? suggestedQuestions : defaultQuestions;

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center text-center py-10 px-4 animate-fadeIn">
      {/* Title */}
      <div className="mb-3">
        <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white inline-block">
          data<span className="text-gradient-devanagari ml-1">दर्शनम्</span>
        </h1>
      </div>

      {/* Subtitle */}
      <p className="text-slate-400 text-base md:text-lg max-w-xl mb-6 font-normal leading-relaxed">
        Ask your business data anything in plain English.<br />
        Get instant interactive charts and AI-generated insights. <strong className="text-slate-200">No SQL. No code.</strong>
      </p>

      {/* Tech Tags */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
        <span className="pill-chip flex items-center gap-1">
          <Brain className="w-3.5 h-3.5 text-indigo-400" />
          <span>Groq LLaMA 3 70B</span>
        </span>
        <span className="pill-chip flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-amber-400" />
          <span>Plotly & Pandas Engine</span>
        </span>
        <span className="pill-chip flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>Multi-turn Context</span>
        </span>
      </div>

      {/* 4 Feature Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 w-full mb-10 text-left">
        <div className="glass-card p-4 glass-card-interactive flex flex-col justify-between">
          <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-3">
            <MessageSquareCode className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 mb-1">Natural Language</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Type queries naturally. The AI parses metrics, dimensions & filters instantly.
            </p>
          </div>
        </div>

        <div className="glass-card p-4 glass-card-interactive flex flex-col justify-between">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 mb-1">Instant Charts</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Bar, line, pie, scatter, area — automatically chosen for your data.
            </p>
          </div>
        </div>

        <div className="glass-card p-4 glass-card-interactive flex flex-col justify-between">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 mb-1">AI Insights</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every chart comes with concise 2–3 sentence business takeaways.
            </p>
          </div>
        </div>

        <div className="glass-card p-4 glass-card-interactive flex flex-col justify-between">
          <div className="w-9 h-9 rounded-xl bg-pink-500/10 border border-pink-500/30 flex items-center justify-center text-pink-400 mb-3">
            <UploadCloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-100 mb-1">Your CSV Data</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Upload any custom dataset — schema is profiled automatically on the fly.
            </p>
          </div>
        </div>
      </div>

      {/* Try these examples / Full Dashboard Button */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>✨ Try These Example Queries</span>
          </span>
          <button
            onClick={onGenerateDashboard}
            className="btn-primary text-xs px-3.5 py-1.5 inline-flex items-center gap-1.5"
          >
            <span>📊 Generate Full Dashboard</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {questionsToDisplay.slice(0, 4).map((q, idx) => (
            <button
              key={idx}
              onClick={() => onSelectQuestion(q)}
              className="glass-card p-3 text-left hover:border-indigo-500/50 hover:bg-slate-800/40 transition-all flex items-center justify-between group"
            >
              <span className="text-xs font-medium text-slate-200 group-hover:text-indigo-300 transition-colors">
                {q}
              </span>
              <span className="text-slate-500 group-hover:text-indigo-400 text-xs transition-colors">
                →
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
