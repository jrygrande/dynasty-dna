import { StatusBadge } from "./StatusBadge";
import { formatDate } from "@/lib/utils";
import type { RoadmapIssue } from "@/app/api/roadmap/route";

/** Extract the hypothesis from a GitHub Issue body (looks for "### Hypothesis" section) */
function extractSection(body: string | null, heading: string): string | null {
  if (!body) return null;
  // Match "### Hypothesis" or "**Hypothesis**" patterns
  const patterns = [
    new RegExp(`###\\s*${heading}\\s*\\n+([\\s\\S]*?)(?=\\n###|\\n\\*\\*|$)`, "i"),
    new RegExp(`\\*\\*${heading}\\*\\*\\s*\\n+([\\s\\S]*?)(?=\\n###|\\n\\*\\*|$)`, "i"),
    // Also match the issue template format: "### Hypothesis\n\nContent"
    new RegExp(`###\\s*${heading}[^\\n]*\\n+([^#]*?)(?=\\n##|$)`, "i"),
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]?.trim()) {
      return match[1].trim().slice(0, 300); // Cap at 300 chars for display
    }
  }
  return null;
}

function extractMetrics(body: string | null): string[] {
  const section = extractSection(body, "Success Metrics");
  if (!section) return [];
  return section
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 4);
}

export function RoadmapCard({ issue }: { issue: RoadmapIssue }) {
  const hypothesis = extractSection(issue.body, "Hypothesis");
  const metrics = extractMetrics(issue.body);

  return (
    <a
      href={issue.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className="block border rounded-lg p-4 hover:border-foreground/20 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-sm font-semibold group-hover:text-primary transition-colors">
          {issue.title}
        </h3>
        <StatusBadge status={issue.status} />
      </div>

      {hypothesis && (
        <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
          <span className="font-medium text-foreground/70">Hypothesis:</span>{" "}
          {hypothesis}
        </p>
      )}

      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
          {metrics.map((metric, i) => (
            <span
              key={i}
              className="text-[11px] text-muted-foreground"
            >
              {metric}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {issue.priority && (
          <span className="uppercase font-medium">{issue.priority}</span>
        )}
        {issue.status === "shipped" && issue.closed_at && (
          <span>Shipped {formatDate(issue.closed_at, "compact")}</span>
        )}
        {issue.status === "in-progress" && (
          <span>Started {formatDate(issue.created_at, "compact")}</span>
        )}
        {issue.tags.length > 0 && (
          <span>{issue.tags.join(" · ")}</span>
        )}
        <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          View on GitHub →
        </span>
      </div>
    </a>
  );
}
