"use client";

import { Fragment, type ReactNode, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface CollapsibleSectionRow {
  key: string;
  title: ReactNode;
  meta?: ReactNode;
  detail: ReactNode;
}

export interface CollapsibleSection {
  key: string;
  heading?: string;
  rows: CollapsibleSectionRow[];
}

interface Props {
  sections: CollapsibleSection[];
  emptyMessage?: string;
  expandAllLabel?: string;
  collapseAllLabel?: string;
}

export function CollapsibleSeasonTable({
  sections,
  emptyMessage = "No data",
  expandAllLabel = "Expand all",
  collapseAllLabel = "Collapse all",
}: Props) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const hasRows = sections.some((s) => s.rows.length > 0);
  if (!hasRows) {
    return (
      <p className="text-muted-foreground text-center py-8">{emptyMessage}</p>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-3 mb-3 text-xs">
        <button
          type="button"
          onClick={() =>
            setExpandedKeys(
              new Set(sections.flatMap((s) => s.rows.map((r) => r.key)))
            )
          }
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {expandAllLabel}
        </button>
        <span aria-hidden className="text-muted-foreground/40">
          |
        </span>
        <button
          type="button"
          onClick={() => setExpandedKeys(new Set())}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapseAllLabel}
        </button>
      </div>

      <div className="space-y-5">
        {sections.map((section) => (
          <section key={section.key}>
            {section.heading && (
              <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 px-1">
                {section.heading}
              </h3>
            )}
            <div className="border rounded-lg overflow-hidden bg-card">
              {section.rows.map((row, idx) => {
                const expanded = expandedKeys.has(row.key);
                return (
                  <Fragment key={row.key}>
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      className={`w-full px-3 sm:px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors ${
                        idx > 0 ? "border-t" : ""
                      }`}
                      aria-expanded={expanded}
                    >
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
                          expanded ? "" : "-rotate-90"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{row.title}</div>
                        {row.meta && (
                          <div className="mt-0.5 text-xs text-muted-foreground font-mono flex flex-wrap gap-x-3 gap-y-0.5">
                            {row.meta}
                          </div>
                        )}
                      </div>
                    </button>
                    {expanded && row.detail}
                  </Fragment>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
