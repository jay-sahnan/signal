import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Parse a LinkedIn search result title like "Jane Doe - VP Sales | Acme Corp" */
export function parseLinkedInTitle(raw: string | undefined): {
  name: string;
  title: string | null;
} {
  if (!raw) return { name: "Unknown", title: null };
  const parts = raw.split(/\s[-|]\s/);
  return {
    name: parts[0]?.trim() || "Unknown",
    title: parts[1]?.trim() || null,
  };
}
