import { trackingReadinessStyles } from "@/lib/status-styles";
import type { ReadinessTag } from "@/lib/types/tracking";

export function ReadinessBadge({ tag }: { tag: ReadinessTag | null }) {
  if (!tag) return null;

  const style = trackingReadinessStyles[tag];
  if (!style) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}
