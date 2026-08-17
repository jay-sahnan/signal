/**
 * Which in-app paths the agent (and chat markdown) may navigate to. Pure, no
 * dependencies, so the client bundle can import it without dragging in the
 * tool runtime.
 *
 * Paths only: no scheme, no host, no protocol-relative `//`, so nothing that
 * reads a path out of model output can become an open redirect.
 */

/** Top-level app routes the agent may open. Keep in step with src/app/. */
export const NAVIGABLE_PREFIXES = [
  "/",
  "/campaigns",
  "/companies",
  "/outreach",
  "/signals",
  "/tracking",
  "/profile",
  "/email-skills",
  "/settings",
  "/chat",
] as const;

export function isNavigablePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  if (/[\s<>"'\\]/.test(path)) return false;
  const pathname = path.split(/[?#]/)[0];
  return NAVIGABLE_PREFIXES.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  );
}
