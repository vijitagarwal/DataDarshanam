"use client";

import React, { useEffect, useRef } from "react";
import { Send, Sparkles, Loader2 } from "lucide-react";

interface ChatInputBarProps {
  onSend: (query: string) => void;
  isLoading?: boolean;
  suggestedQuestions?: string[];
  value: string;
  onChange: (value: string) => void;
  focusRequest?: number;
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  onSend,
  isLoading = false,
  suggestedQuestions = [],
  value,
  onChange,
  focusRequest = 0,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const placeholder = suggestedQuestions[0]
    ? `Ask a question, for example: ${suggestedQuestions[0]}`
    : "Ask a question about the selected dataset";

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || isLoading) return;
    onSend(value.trim());
    onChange("");
  };

  return (
    <div className="ledger-composer">
      <form
        onSubmit={handleSubmit}
        className="ledger-composer-form"
      >
        <div className="ledger-composer-icon" aria-hidden="true">
          <Sparkles className="w-5 h-5" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={isLoading}
          className="ledger-composer-input"
          aria-label="Ask a question about the selected dataset"
        />

        <button
          type="submit"
          disabled={!value.trim() || isLoading}
          className="ledger-button ledger-button-primary ledger-send-button"
          aria-label={isLoading ? "Running question" : "Run question"}
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          <span className="hidden sm:inline">{isLoading ? "Working…" : "Ask"}</span>
        </button>
      </form>
      <p className="ledger-composer-hint" aria-live="polite">
        {isLoading ? "Your question is being processed…" : "Results use the selected dataset. Press Enter to submit."}
      </p>
    </div>
  );
};
