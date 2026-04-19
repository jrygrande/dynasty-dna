type Status = "shipped" | "in-progress" | "planned" | "exploring";

const STATUS_STYLES: Record<Status, string> = {
  shipped: "bg-grade-a/15 text-grade-a",
  "in-progress": "bg-grade-b/15 text-grade-b",
  planned: "bg-grade-c/15 text-grade-c",
  exploring: "bg-chart-4/15 text-chart-4",
};

const STATUS_LABELS: Record<Status, string> = {
  shipped: "Shipped",
  "in-progress": "In progress",
  planned: "Planned",
  exploring: "Exploring",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${
        STATUS_STYLES[status] || "bg-muted text-muted-foreground"
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
