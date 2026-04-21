export function resolvePath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = splitPath(path);
  let cursor: unknown = root;
  for (const part of parts) {
    if (cursor == null) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return cursor;
}

function splitPath(path: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const ch of path) {
    if (ch === "." || ch === "[") {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    if (ch === "]") continue;
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

const MUSTACHE = /\{\{\s*([^}]+?)\s*\}\}/g;

export function renderTemplate(
  template: string,
  scope: Record<string, unknown>,
): string {
  return template.replace(MUSTACHE, (_, expr: string) => {
    const value = resolvePath(scope, expr);
    if (value == null) return "";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  });
}

export function resolveArgs(
  args: Record<string, unknown>,
  scope: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = resolveValue(value, scope);
  }
  return out;
}

function resolveValue(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const wholeMatch = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (wholeMatch) {
      return resolvePath(scope, wholeMatch[1]);
    }
    if (MUSTACHE.test(value)) {
      return renderTemplate(value, scope);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, scope));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveValue(v, scope);
    }
    return out;
  }
  return value;
}
