"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface StreamingContextValue {
  isStreaming: boolean;
  /** Register a chat as streaming. Returns an unregister function. */
  register: (id: string) => () => void;
  /** Prompt user to confirm navigation. Returns true if safe to proceed. */
  confirmNavigation: () => boolean;
}

const StreamingContext = createContext<StreamingContextValue>({
  isStreaming: false,
  register: () => () => {},
  confirmNavigation: () => true,
});

export function StreamingProvider({ children }: { children: ReactNode }) {
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const activeRef = useRef(activeIds);
  useEffect(() => {
    activeRef.current = activeIds;
  }, [activeIds]);

  const register = useCallback((id: string) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    return () => {
      setActiveIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    };
  }, []);

  const isStreaming = activeIds.size > 0;

  const confirmNavigation = useCallback(() => {
    if (activeRef.current.size === 0) return true;
    return window.confirm("The agent is still working. Leave this page?");
  }, []);

  // Warn on hard navigation (refresh, tab close) while streaming
  useEffect(() => {
    if (!isStreaming) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isStreaming]);

  const value = useMemo(
    () => ({ isStreaming, register, confirmNavigation }),
    [isStreaming, register, confirmNavigation],
  );

  return <StreamingContext value={value}>{children}</StreamingContext>;
}

export function useStreaming() {
  return useContext(StreamingContext);
}
