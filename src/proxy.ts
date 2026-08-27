import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/login(.*)",
  "/signup(.*)",
  "/api/jobs(.*)",
  // Container orchestrators cannot present a session, and a health check that
  // 307s to /login tells them nothing. Returns a fixed literal, reads nothing.
  "/api/health",
  // MCP does its own bearer verification; a cookie redirect to /login would
  // break the OAuth discovery handshake for Claude Code / Codex.
  "/api/mcp(.*)",
  "/.well-known/(.*)",
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
