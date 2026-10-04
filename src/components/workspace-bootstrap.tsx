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
    if (userId) await resolveWorkspace(userId);
    return <WorkspaceGate initialUser={userId}>{children}</WorkspaceGate>;
  }
  return children;
}
