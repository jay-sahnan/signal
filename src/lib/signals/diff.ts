import type { SignalDiff } from "./types";

export function structuralDiff(
  baseline: unknown,
  current: unknown,
  keyBy?: string,
): SignalDiff {
  if (baseline == null && current != null) {
    return {
      changed: true,
      from: null,
      to: current,
      description: "First observed value (no prior baseline).",
    };
  }

  if (Array.isArray(baseline) && Array.isArray(current)) {
    return diffArrays(baseline, current, keyBy);
  }

  if (isObject(baseline) && isObject(current)) {
    return diffObjects(baseline, current);
  }

  const changed = !deepEqual(baseline, current);
  return {
    changed,
    from: baseline,
    to: current,
    description: changed
      ? `Changed from ${formatValue(baseline)} to ${formatValue(current)}.`
      : "No change.",
  };
}

function diffArrays(
  baseline: unknown[],
  current: unknown[],
  keyBy?: string,
): SignalDiff {
  if (keyBy) {
    const basMap = indexBy(baseline, keyBy);
    const curMap = indexBy(current, keyBy);
    const added: unknown[] = [];
    const removed: unknown[] = [];
    const changed: Array<{ key: string; from: unknown; to: unknown }> = [];
    for (const [key, item] of curMap) {
      if (!basMap.has(key)) added.push(item);
      else if (!deepEqual(item, basMap.get(key)))
        changed.push({ key, from: basMap.get(key), to: item });
    }
    for (const [key, item] of basMap) {
      if (!curMap.has(key)) removed.push(item);
    }
    const parts: string[] = [];
    if (added.length)
      parts.push(`added ${added.length} (${summarizeKeys(added, keyBy)})`);
    if (removed.length)
      parts.push(
        `removed ${removed.length} (${summarizeKeys(removed, keyBy)})`,
      );
    if (changed.length)
      parts.push(
        `changed ${changed.length} (${changed
          .map((c) => c.key)
          .slice(0, 5)
          .join(", ")})`,
      );
    const didChange = added.length + removed.length + changed.length > 0;
    return {
      changed: didChange,
      from: baseline,
      to: current,
      description: didChange ? parts.join("; ") : "No change.",
    };
  }
  const changed = !deepEqual(baseline, current);
  return {
    changed,
    from: baseline,
    to: current,
    description: changed
      ? `List changed from ${baseline.length} to ${current.length} items.`
      : "No change.",
  };
}

function diffObjects(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
): SignalDiff {
  const changedKeys: string[] = [];
  const keys = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const k of keys) {
    if (!deepEqual(baseline[k], current[k])) changedKeys.push(k);
  }
  return {
    changed: changedKeys.length > 0,
    from: baseline,
    to: current,
    description:
      changedKeys.length > 0
        ? `Changed fields: ${changedKeys.join(", ")}.`
        : "No change.",
  };
}

function indexBy(items: unknown[], key: string): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const item of items) {
    if (isObject(item)) {
      const k = item[key];
      if (typeof k === "string" || typeof k === "number")
        map.set(String(k), item);
    }
  }
  return map;
}

function summarizeKeys(items: unknown[], key: string): string {
  return items
    .map((i) => (isObject(i) ? i[key] : i))
    .slice(0, 5)
    .join(", ");
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return `"${v}"`;
  if (v == null) return "null";
  return JSON.stringify(v);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    for (const k of ak)
      if (
        !deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      )
        return false;
    return true;
  }
  return false;
}
