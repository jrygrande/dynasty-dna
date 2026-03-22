import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(
  input: string | number | null,
  style: "compact" | "short" | "long" = "short"
): string {
  if (!input) return "";
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { month: "long", day: "numeric", year: "numeric" }
      : style === "compact"
        ? { month: "short", day: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" };
  return new Date(input).toLocaleDateString("en-US", opts);
}
