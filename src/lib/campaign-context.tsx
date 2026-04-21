"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

interface CampaignContextValue {
  activeCampaignId: string | null;
  setActiveCampaignId: (id: string | null) => void;
  agentOpen: boolean;
  setAgentOpen: (open: boolean) => void;
  pendingPrompt: string | null;
  consumePendingPrompt: () => string | null;
  openAgentWith: (prefill?: string) => void;
}

const CampaignContext = createContext<CampaignContextValue>({
  activeCampaignId: null,
  setActiveCampaignId: () => {},
  agentOpen: false,
  setAgentOpen: () => {},
  pendingPrompt: null,
  consumePendingPrompt: () => null,
  openAgentWith: () => {},
});

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);

  const consumePendingPrompt = useCallback(() => {
    const value = pendingPrompt;
    if (value !== null) setPendingPrompt(null);
    return value;
  }, [pendingPrompt]);

  const openAgentWith = useCallback((prefill?: string) => {
    if (prefill) setPendingPrompt(prefill);
    setAgentOpen(true);
  }, []);

  return (
    <CampaignContext
      value={{
        activeCampaignId,
        setActiveCampaignId,
        agentOpen,
        setAgentOpen,
        pendingPrompt,
        consumePendingPrompt,
        openAgentWith,
      }}
    >
      {children}
    </CampaignContext>
  );
}

export function useCampaign() {
  return useContext(CampaignContext);
}
