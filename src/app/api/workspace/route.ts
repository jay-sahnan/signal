import { auth } from "@clerk/nextjs/server";
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";
export async function POST() {
  if (!isHostedMode()) return new Response(null, { status: 404 });
  const { userId } = await auth();
  if (!userId) return new Response(null, { status: 401 });
  try {
    await resolveWorkspace(userId);
    return Response.json(
      { ready: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Workspace unavailable" }, { status: 503 });
  }
}
