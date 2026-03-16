/**
 * nflverse data fetcher.
 *
 * Fetches CSV data files from nflverse GitHub releases:
 * https://github.com/nflverse/nflverse-data/releases
 *
 * Available datasets:
 * - injuries: Weekly player injury reports
 * - schedules: NFL game schedules with scores
 */

import { parse } from "csv-parse/sync";

const NFLVERSE_BASE =
  "https://github.com/nflverse/nflverse-data/releases/download";

export interface NFLVerseInjury {
  season: number;
  week: number;
  gsis_id: string;
  full_name: string;
  team: string;
  position: string;
  report_status: string; // Out, Doubtful, Questionable, Probable, null
  practice_status: string;
}

export interface NFLVerseGame {
  season: number;
  week: number;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  gameday: string; // YYYY-MM-DD
}

async function fetchCSV<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`nflverse fetch error: ${res.status} for ${url}`);
  }
  const text = await res.text();
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
  }) as T[];
}

export async function getInjuries(season: number): Promise<NFLVerseInjury[]> {
  const url = `${NFLVERSE_BASE}/injuries/injuries_${season}.csv`;
  const raw = await fetchCSV<Record<string, unknown>>(url);
  return raw.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    gsis_id: String(r.gsis_id || ""),
    full_name: String(r.full_name || ""),
    team: String(r.team || ""),
    position: String(r.position || ""),
    report_status: String(r.report_status || ""),
    practice_status: String(r.practice_status || ""),
  }));
}

export async function getSchedule(season: number): Promise<NFLVerseGame[]> {
  const url = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
  const raw = await fetchCSV<Record<string, unknown>>(url);
  return raw
    .filter((r) => Number(r.season) === season && String(r.game_type) === "REG")
    .map((r) => ({
      season: Number(r.season),
      week: Number(r.week),
      home_team: String(r.home_team || ""),
      away_team: String(r.away_team || ""),
      home_score: r.home_score != null && r.home_score !== "" ? Number(r.home_score) : null,
      away_score: r.away_score != null && r.away_score !== "" ? Number(r.away_score) : null,
      gameday: String(r.gameday || ""),
    }));
}
