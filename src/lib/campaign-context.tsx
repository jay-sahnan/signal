"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
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
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  chatListVersion: number;
  bumpChatList: () => void;
  loadChatId: string | null;
  requestLoadChat: (chatId: string) => void;
  consumeLoadChat: () => string | null;
}

const CampaignContext = createContext<CampaignContextValue>({
  activeCampaignId: null,
  setActiveCampaignId: () => {},
  agentOpen: false,
  setAgentOpen: () => {},
  pendingPrompt: null,
  consumePendingPrompt: () => null,
  openAgentWith: () => {},
  activeChatId: null,
  setActiveChatId: () => {},
  chatListVersion: 0,
  bumpChatList: () => {},
  loadChatId: null,
  requestLoadChat: () => {},
  consumeLoadChat: () => null,
});

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatListVersion, setChatListVersion] = useState(0);
  const [loadChatId, setLoadChatId] = useState<string | null>(null);

  const consumePendingPrompt = useCallback(() => {
    const value = pendingPrompt;
    if (value !== null) setPendingPrompt(null);
    return value;
  }, [pendingPrompt]);

  const openAgentWith = useCallback((prefill?: string) => {
    if (prefill) setPendingPrompt(prefill);
    setAgentOpen(true);
  }, []);

  const bumpChatList = useCallback(() => {
    setChatListVersion((v) => v + 1);
  }, []);

  const requestLoadChat = useCallback((chatId: string) => {
    setLoadChatId(chatId);
    setAgentOpen(true);
  }, []);

  const consumeLoadChat = useCallback(() => {
    const val = loadChatId;
    if (val !== null) setLoadChatId(null);
    return val;
  }, [loadChatId]);

  const value = useMemo<CampaignContextValue>(
    () => ({
      activeCampaignId,
      setActiveCampaignId,
      agentOpen,
      setAgentOpen,
      pendingPrompt,
      consumePendingPrompt,
      openAgentWith,
      activeChatId,
      setActiveChatId,
      chatListVersion,
      bumpChatList,
      loadChatId,
      requestLoadChat,
      consumeLoadChat,
    }),
    [
      activeCampaignId,
      agentOpen,
      pendingPrompt,
      consumePendingPrompt,
      openAgentWith,
      activeChatId,
      chatListVersion,
      bumpChatList,
      loadChatId,
      requestLoadChat,
      consumeLoadChat,
    ],
  );

  return <CampaignContext value={value}>{children}</CampaignContext>;
}

export function useCampaign() {
  return useContext(CampaignContext);
}
