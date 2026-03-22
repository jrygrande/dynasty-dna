const STATUS_STYLES: Record<string, string> = {
  shipped:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  "in-progress":
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  planned:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  exploring:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
};

const STATUS_LABELS: Record<string, string> = {
  shipped: "Shipped",
  "in-progress": "In Progress",
  planned: "Planned",
  exploring: "Exploring",
};

type Status = "shipped" | "in-progress" | "planned" | "exploring";

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${
        STATUS_STYLES[status] || "bg-gray-100 text-gray-800"
      }`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
