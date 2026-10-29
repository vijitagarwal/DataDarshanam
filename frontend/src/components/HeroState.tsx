"use client";

import React from "react";
import { ArrowRight, BookOpenText, Sparkles } from "lucide-react";

interface HeroStateProps {
  suggestedQuestions?: string[];
  onSelectQuestion: (question: string) => void;
  onGenerateDashboard: () => void;
}

export const HeroState: React.FC<HeroStateProps> = ({
  suggestedQuestions = [],
  onSelectQuestion,
  onGenerateDashboard,
}) => (
  <section className="ledger-empty-state" aria-labelledby="analyze-empty-heading">
    <p className="ledger-kicker"><Sparkles size={14} aria-hidden="true" /> Start with a question</p>
    <h2 id="analyze-empty-heading">Make sense of your data.</h2>
    <p className="ledger-lede">
      Ask a plain-language question. Each briefing brings the finding, figures computed from the result rows, a chart, and the rows behind it together.
    </p>
    <div className="ledger-example-heading">
      <h2><BookOpenText size={17} aria-hidden="true" /> Try a question from this dataset</h2>
      <button type="button" className="ledger-text-button" onClick={onGenerateDashboard}>
        Build dataset overview <ArrowRight size={15} aria-hidden="true" />
      </button>
    </div>
    {suggestedQuestions.length > 0 ? (
      <ul className="ledger-example-list">
        {suggestedQuestions.slice(0, 5).map((question) => (
          <li key={question}>
            <button type="button" onClick={() => onSelectQuestion(question)}>
              <span>{question}</span><ArrowRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="ledger-muted">Dataset suggestions will appear once a dataset is available.</p>
    )}
  </section>
);
