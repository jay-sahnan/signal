import { WorkspaceGate } from "./workspace-gate";
import type { ReactNode } from "react";
import { auth } from "@clerk/nextjs/server";
import { isHostedMode, resolveWorkspace } from "@/lib/auth/workspace";

/** Provision before mounting browser components that query Supabase directly. */
export async function WorkspaceBootstrap({
  children,
}: {
  children: ReactNode;
}) {
  if (isHostedMode()) {
    const { userId } = await auth();
    let initialReady = true;
    try {
      if (userId) await resolveWorkspace(userId);
    } catch {
      initialReady = false;
    }
    return (
      <WorkspaceGate initialUser={userId} initialReady={initialReady}>
        {children}
      </WorkspaceGate>
    );
  }
  return children;
}
