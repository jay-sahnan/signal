"use client";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useEffect, useState, type ReactNode } from "react";

export function WorkspaceGate({
  initialUser,
  children,
}: {
  initialUser: string | null;
  children: ReactNode;
}) {
  const { isLoaded, userId } = useAuth();
  const router = useRouter();
  const currentUser = userId ?? null;
  const [failedUser, setFailedUser] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isLoaded || initialUser === currentUser) return;
    if (!currentUser) {
      router.refresh();
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    void fetch("/api/workspace", { method: "POST", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || (await response.json()).ready !== true)
          throw new Error("Unavailable");
        if (active) router.refresh();
      })
      .catch(() => {
        if (active) setFailedUser(currentUser);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [isLoaded, currentUser, initialUser, attempt, router]);
  if (!isLoaded) return <p role="status">Loading workspace…</p>;
  if (initialUser === currentUser) return children;
  if (currentUser && failedUser === currentUser)
    return (
      <div className="p-6">
        <p role="alert">
          Workspace unavailable. Please retry or contact support.
        </p>
        <button
          className="min-h-11 underline"
          onClick={() => {
            setFailedUser(null);
            setAttempt((value) => value + 1);
          }}
        >
          Retry
        </button>
      </div>
    );
  return (
    <div className="p-6">
      <p role="status">Preparing your workspace…</p>
      <button
        className="min-h-11 underline"
        onClick={() => setAttempt((value) => value + 1)}
      >
        Retry
      </button>
    </div>
  );
}
