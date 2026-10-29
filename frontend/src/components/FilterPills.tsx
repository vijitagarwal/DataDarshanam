"use client";

import React from "react";
import { FilterItem } from "@/lib/types";
import { Calendar, Tag, MapPin, Filter } from "lucide-react";

interface FilterPillsProps {
  filters?: FilterItem[];
}

export const FilterPills: React.FC<FilterPillsProps> = ({ filters }) => {
  if (!filters || filters.length === 0) return null;

  const getIcon = (field: string) => {
    const f = field.toLowerCase();
    if (f.includes("year") || f.includes("month") || f.includes("date")) return <Calendar className="w-3 h-3" />;
    if (f.includes("region") || f.includes("city") || f.includes("country")) return <MapPin className="w-3 h-3" />;
    if (f.includes("category") || f.includes("type")) return <Tag className="w-3 h-3" />;
    return <Filter className="w-3 h-3" />;
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3" aria-label="Applied query filters">
      <span className="ledger-kicker">Filters</span>
      {filters.map((f, i) => (
        <span
          key={i}
          className="ledger-tag"
        >
          {getIcon(f.field)}
          <span>
            <strong className="capitalize">{f.field.replace(/_/g, " ")}</strong>{" "}
            {f.operator || "eq"} {String(f.value)}
          </span>
        </span>
      ))}
    </div>
  );
};
