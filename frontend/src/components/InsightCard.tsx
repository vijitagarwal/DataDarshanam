"use client";

import React from "react";
import { Sparkles, AlertTriangle, Bot } from "lucide-react";

interface InsightCardProps {
  insight: string;
  fallback?: boolean;
}

export const InsightCard: React.FC<InsightCardProps> = ({ insight, fallback }) => {
  return (
    <div className="glass-card p-4 mb-3 border-emerald-500/30 bg-emerald-950/20 relative overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>AI Insight</span>
        </div>
        {fallback ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3 h-3" />
            Estimated
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
            <Bot className="w-3 h-3" />
            LLaMA 3 70B
          </span>
        )}
      </div>
      <p className="text-xs md:text-sm text-slate-300 leading-relaxed font-normal">
        {insight}
      </p>
    </div>
  );
};
