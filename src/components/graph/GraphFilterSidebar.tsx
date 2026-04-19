"use client";

import { useMemo, useState } from "react";
import type { TransactionKind } from "@/lib/assetGraph";
import { trackEvent } from "@/lib/analytics";

interface ManagerOption {
  userId: string;
  displayName: string;
  avatar: string | null;
}

interface GraphFilterSidebarProps {
  seasons: string[];
  managers: ManagerOption[];
  selectedSeasons: string[];
  selectedManagers: string[];
  selectedTxKinds: TransactionKind[];
  onSeasonsChange: (s: string[]) => void;
  onManagersChange: (m: string[]) => void;
  onTxKindsChange: (k: TransactionKind[]) => void;
}

const TX_KIND_LABELS: Array<[TransactionKind, string]> = [
  ["trade", "Trades"],
  ["draft", "Drafts"],
  ["waiver", "Waivers"],
  ["free_agent", "Free agents"],
];

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group border rounded-md bg-card" open={defaultOpen}>
      <summary className="flex items-center justify-between cursor-pointer list-none select-none px-3 py-2 text-sm font-medium">
        <span>{title}</span>
        <span
          aria-hidden
          className="text-muted-foreground transition-transform group-open:rotate-90"
        >
          &rsaquo;
        </span>
      </summary>
      <div className="px-3 pb-3 pt-0 text-sm">{children}</div>
    </details>
  );
}

export function GraphFilterSidebar({
  seasons,
  managers,
  selectedSeasons,
  selectedManagers,
  selectedTxKinds,
  onSeasonsChange,
  onManagersChange,
  onTxKindsChange,
}: GraphFilterSidebarProps) {
  const [managerQuery, setManagerQuery] = useState("");

  const filteredManagers = useMemo(() => {
    const q = managerQuery.trim().toLowerCase();
    if (!q) return managers;
    return managers.filter((m) => m.displayName.toLowerCase().includes(q));
  }, [managerQuery, managers]);

  function handleSeasonToggle(season: string) {
    const next = toggle(selectedSeasons, season);
    onSeasonsChange(next);
    trackEvent("graph_filter_changed", { filterName: "seasons", newValue: next });
  }

  function handleManagerToggle(userId: string) {
    const next = toggle(selectedManagers, userId);
    onManagersChange(next);
    trackEvent("graph_filter_changed", { filterName: "managers", newValue: next });
  }

  function handleTxKindToggle(kind: TransactionKind) {
    const next = toggle(selectedTxKinds, kind);
    onTxKindsChange(next);
    trackEvent("graph_filter_changed", { filterName: "txKinds", newValue: next });
  }

  return (
    <aside aria-label="Graph filters" className="flex flex-col gap-3 text-sm">
      <Section title="Seasons">
        {seasons.length === 0 ? (
          <p className="text-xs text-muted-foreground">No seasons yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {seasons.map((s) => (
              <li key={s}>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={selectedSeasons.includes(s)}
                    onChange={() => handleSeasonToggle(s)}
                  />
                  <span>{s}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Managers">
        <div className="space-y-2">
          <input
            type="text"
            value={managerQuery}
            onChange={(e) => setManagerQuery(e.target.value)}
            placeholder="Search managers…"
            className="w-full px-2 py-1 text-xs rounded-md border bg-background"
          />
          {managers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No managers yet.</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {filteredManagers.map((m) => (
                <li key={m.userId}>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={selectedManagers.includes(m.userId)}
                      onChange={() => handleManagerToggle(m.userId)}
                    />
                    <span className="truncate">{m.displayName}</span>
                  </label>
                </li>
              ))}
              {filteredManagers.length === 0 && (
                <li className="text-xs text-muted-foreground">No matches.</li>
              )}
            </ul>
          )}
        </div>
      </Section>

      <Section title="Transaction types">
        <ul className="space-y-1.5">
          {TX_KIND_LABELS.map(([kind, label]) => (
            <li key={kind}>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={selectedTxKinds.includes(kind)}
                  onChange={() => handleTxKindToggle(kind)}
                />
                <span>{label}</span>
              </label>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}

export default GraphFilterSidebar;
