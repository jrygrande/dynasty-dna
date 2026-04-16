"use client";

import { useMemo, useState } from "react";
import type { GraphEdgeKind, GraphFocus } from "@/lib/assetGraph";
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
  selectedEventTypes: GraphEdgeKind[];
  focus: GraphFocus | null;
  focusHops: number;
  layoutMode: "band" | "dagre";
  onSeasonsChange: (s: string[]) => void;
  onManagersChange: (m: string[]) => void;
  onEventTypesChange: (e: GraphEdgeKind[]) => void;
  onFocusChange: (f: GraphFocus | null) => void;
  onFocusHopsChange: (n: number) => void;
  onLayoutModeChange: (m: "band" | "dagre") => void;
}

const TRADE_KINDS: GraphEdgeKind[] = [
  "trade_out",
  "trade_in",
  "pick_trade_out",
  "pick_trade_in",
];
const DRAFT_KINDS: GraphEdgeKind[] = ["draft_selected_mgr", "draft_selected_pick"];
const WAIVER_KINDS: GraphEdgeKind[] = ["waiver_add"];
const FREE_AGENT_KINDS: GraphEdgeKind[] = ["free_agent_add"];

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function allChecked(target: GraphEdgeKind[], selected: GraphEdgeKind[]): boolean {
  return target.every((k) => selected.includes(k));
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
    <details
      className="group border rounded-md bg-card"
      open={defaultOpen}
    >
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
  selectedEventTypes,
  focus,
  focusHops,
  layoutMode,
  onSeasonsChange,
  onManagersChange,
  onEventTypesChange,
  onFocusChange,
  onFocusHopsChange,
  onLayoutModeChange,
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

  function handleEventTypeGroupToggle(group: GraphEdgeKind[]) {
    const hasAll = allChecked(group, selectedEventTypes);
    const next = hasAll
      ? selectedEventTypes.filter((k) => !group.includes(k))
      : Array.from(new Set<GraphEdgeKind>([...selectedEventTypes, ...group]));
    onEventTypesChange(next);
    trackEvent("graph_filter_changed", { filterName: "eventTypes", newValue: next });
  }

  function handleFocusKindChange(value: string) {
    if (value === "none") {
      onFocusChange(null);
      return;
    }
    if (value === "manager" && managers.length > 0) {
      const next: GraphFocus = { kind: "manager", userId: managers[0].userId };
      onFocusChange(next);
      trackEvent("graph_focus_set", { focusType: "manager", hops: focusHops });
    }
  }

  const focusKind = focus?.kind ?? "none";

  return (
    <aside
      aria-label="Graph filters"
      className="flex flex-col gap-3 text-sm"
    >
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

      <Section title="Event types">
        <ul className="space-y-1.5">
          <li>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={allChecked(TRADE_KINDS, selectedEventTypes)}
                onChange={() => handleEventTypeGroupToggle(TRADE_KINDS)}
              />
              <span>Trades</span>
            </label>
          </li>
          <li>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={allChecked(DRAFT_KINDS, selectedEventTypes)}
                onChange={() => handleEventTypeGroupToggle(DRAFT_KINDS)}
              />
              <span>Drafts</span>
            </label>
          </li>
          <li>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={allChecked(WAIVER_KINDS, selectedEventTypes)}
                onChange={() => handleEventTypeGroupToggle(WAIVER_KINDS)}
              />
              <span>Waivers</span>
            </label>
          </li>
          <li>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-primary"
                checked={allChecked(FREE_AGENT_KINDS, selectedEventTypes)}
                onChange={() => handleEventTypeGroupToggle(FREE_AGENT_KINDS)}
              />
              <span>Free agents</span>
            </label>
          </li>
        </ul>
      </Section>

      <Section title="Focus">
        <div className="space-y-2">
          <label className="block text-xs text-muted-foreground">Focus type</label>
          <select
            value={focusKind}
            onChange={(e) => handleFocusKindChange(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded-md border bg-background"
          >
            <option value="none">None</option>
            <option value="manager">Manager</option>
          </select>

          {focus?.kind === "manager" && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Manager</label>
              <select
                value={focus.userId}
                onChange={(e) => {
                  const next: GraphFocus = { kind: "manager", userId: e.target.value };
                  onFocusChange(next);
                  trackEvent("graph_focus_set", { focusType: "manager", hops: focusHops });
                }}
                className="w-full px-2 py-1 text-xs rounded-md border bg-background"
              >
                {managers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Hops: <span className="font-medium text-foreground">{focusHops}</span>
            </label>
            <input
              type="range"
              min={0}
              max={4}
              step={1}
              value={focusHops}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                onFocusHopsChange(n);
                if (focus) {
                  trackEvent("graph_focus_set", { focusType: focus.kind, hops: n });
                }
              }}
              className="w-full"
            />
          </div>
        </div>
      </Section>

      <Section title="Layout" defaultOpen={false}>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              type="radio"
              name="graph-layout"
              className="accent-primary"
              checked={layoutMode === "band"}
              onChange={() => {
                onLayoutModeChange("band");
                trackEvent("graph_filter_changed", { filterName: "layout", newValue: "band" });
              }}
            />
            <span>Band</span>
          </label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
            <input
              type="radio"
              name="graph-layout"
              className="accent-primary"
              checked={layoutMode === "dagre"}
              onChange={() => {
                onLayoutModeChange("dagre");
                trackEvent("graph_filter_changed", { filterName: "layout", newValue: "dagre" });
              }}
            />
            <span>Dagre</span>
          </label>
        </div>
      </Section>
    </aside>
  );
}

export default GraphFilterSidebar;
