import { NextResponse } from "next/server";

export interface RoadmapIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  status: "shipped" | "in-progress" | "planned" | "exploring";
  phase: number | null;
  priority: "p0" | "p1" | "p2" | null;
  type: "feature" | "experiment" | "bug" | "other";
  tags: string[];
  created_at: string;
  closed_at: string | null;
}

const REPO = "jrygrande/dynasty-dna";
const GITHUB_API = `https://api.github.com/repos/${REPO}/issues`;

function extractLabel(labels: Array<{ name: string }>, prefix: string): string | null {
  const label = labels.find((l) => l.name.startsWith(`${prefix}:`));
  return label ? label.name.slice(prefix.length + 1) : null;
}

function parseIssue(issue: {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: Array<{ name: string }>;
  created_at: string;
  closed_at: string | null;
  state: string;
}): RoadmapIssue {
  const statusRaw = extractLabel(issue.labels, "status");
  const phaseRaw = extractLabel(issue.labels, "phase");
  const priorityRaw = extractLabel(issue.labels, "priority");
  const typeRaw = extractLabel(issue.labels, "type");

  // Infer status from GitHub issue state if no status label
  let status: RoadmapIssue["status"] = "planned";
  if (statusRaw === "shipped" || (issue.state === "closed" && !statusRaw)) {
    status = "shipped";
  } else if (statusRaw === "in-progress") {
    status = "in-progress";
  } else if (statusRaw === "exploring") {
    status = "exploring";
  } else if (statusRaw === "planned") {
    status = "planned";
  }

  const tags = issue.labels
    .map((l) => l.name)
    .filter((n) => !n.startsWith("status:") && !n.startsWith("phase:") && !n.startsWith("priority:") && !n.startsWith("type:") && n !== "roadmap");

  return {
    id: issue.id,
    number: issue.number,
    title: issue.title.replace(/^\[(Feature|Experiment|Bug)\]\s*/i, ""),
    body: issue.body,
    html_url: issue.html_url,
    status,
    phase: phaseRaw ? parseInt(phaseRaw, 10) : null,
    priority: (priorityRaw as RoadmapIssue["priority"]) || null,
    type: (typeRaw as RoadmapIssue["type"]) || "other",
    tags,
    created_at: issue.created_at,
    closed_at: issue.closed_at,
  };
}

export async function GET() {
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "dynasty-dna-roadmap",
    };

    // Use GITHUB_TOKEN if available for higher rate limits
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    // Fetch both open and closed issues with the "roadmap" label
    const [openRes, closedRes] = await Promise.all([
      fetch(`${GITHUB_API}?labels=roadmap&state=open&per_page=100`, {
        headers,
        next: { revalidate: 600 }, // ISR: revalidate every 10 minutes
      }),
      fetch(`${GITHUB_API}?labels=roadmap&state=closed&per_page=100`, {
        headers,
        next: { revalidate: 600 },
      }),
    ]);

    if (!openRes.ok || !closedRes.ok) {
      // Fallback: return empty with an error indicator
      // This handles rate limiting gracefully
      return NextResponse.json({
        items: [],
        error: "Unable to fetch roadmap data from GitHub. Please try again later.",
        rateLimited: openRes.status === 403 || closedRes.status === 403,
      });
    }

    const [openIssues, closedIssues] = await Promise.all([
      openRes.json(),
      closedRes.json(),
    ]);

    const allIssues = [...openIssues, ...closedIssues]
      .filter((issue: { pull_request?: unknown }) => !issue.pull_request) // Exclude PRs
      .map(parseIssue);

    // Sort: in-progress first, then by phase, then by priority
    const priorityOrder = { p0: 0, p1: 1, p2: 2 };
    const statusOrder = { "in-progress": 0, planned: 1, exploring: 2, shipped: 3 };

    allIssues.sort((a, b) => {
      const statusDiff = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      if (statusDiff !== 0) return statusDiff;
      const phaseDiff = (a.phase ?? 99) - (b.phase ?? 99);
      if (phaseDiff !== 0) return phaseDiff;
      const priDiff = (priorityOrder[a.priority ?? "p2"] ?? 99) - (priorityOrder[b.priority ?? "p2"] ?? 99);
      return priDiff;
    });

    return NextResponse.json({ items: allIssues, error: null });
  } catch {
    return NextResponse.json({
      items: [],
      error: "Failed to fetch roadmap data.",
    });
  }
}
