"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { saveChat, loadChat } from "@/lib/services/chat-history";

const MIN_WIDTH = 360;
const MAX_WIDTH_RATIO = 0.6;
const DEFAULT_WIDTH = 480;

function getSuggestions(pathname: string): string[] {
  if (pathname === "/icp") {
    return [
      "Enrich Westlake Financial and run signals",
      "Find auto finance companies with CFPB complaints",
      "Search for companies hiring compliance roles",
      "Run the full pipeline for complaints ICP",
    ];
  }

  if (pathname === "/" || pathname === "") {
    return [
      "Who should I reach out to this week?",
      "What signals fired this week?",
      "Find more companies for complaints ICP",
      "Run signals on all new companies",
    ];
  }

  if (pathname.startsWith("/company/")) {
    return [
      "Enrich this company",
      "Find decision-makers here",
      "Run signals against this company",
      "Generate outreach for top contacts",
    ];
  }

  return [
    "Find companies matching my ICP",
    "Search for decision-makers",
    "What signals fired this week?",
    "Run the daily pipeline",
  ];
}

function pageContextFromPath(pathname: string): string {
  if (!pathname) return "Unknown page";
  if (pathname === "/" || pathname === "") return "Weekly signal feed";
  if (pathname === "/icp")
    return "ICP management — adding companies to targeting";
  if (pathname.startsWith("/company/"))
    return "Company detail page — viewing company signals and contacts";
  if (pathname === "/chat") return "Chat home";
  if (pathname.startsWith("/chat/")) return "Inside a specific chat thread";
  if (pathname === "/settings") return "Settings page";
  return `Page: ${pathname}`;
}

interface AgentPanelInnerProps {
  chatId: string;
  initialMessages: UIMessage[];
  campaignId: string | null;
  onChatSaved: () => void;
}

function AgentPanelInner({
  chatId,
  initialMessages,
  campaignId,
  onChatSaved,
}: AgentPanelInnerProps) {
  const [input, setInput] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const pathname = usePathname();
  const { register } = useStreaming();
  const { consumePendingPrompt } = useCampaign();
  const didAutoSend = useRef(false);

  const { messages, sendMessage, status, stop } = useChat({
    id: `agent-${chatId}`,
    messages: initialMessages,
    onFinish({ messages: allMessages }) {
      saveChat(chatId, allMessages, campaignId ?? undefined);
      onChatSaved();
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (isLoading) return register("agent-panel");
  }, [isLoading, register]);

  const buildRequestOptions = useCallback(() => {
    const pageContext = pageContextFromPath(pathname ?? "");
    const body: Record<string, unknown> = { pageContext };
    if (campaignId) body.campaignId = campaignId;
    return { body };
  }, [campaignId, pathname]);

  // Auto-send any prompt that was queued via openAgentWith()
  useEffect(() => {
    if (didAutoSend.current) return;
    const pending = consumePendingPrompt();
    if (pending) {
      didAutoSend.current = true;
      sendMessage({ text: pending }, buildRequestOptions());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSuggestionClick = (text: string) => {
    sendMessage({ text }, buildRequestOptions());
  };

  const onSubmit = () => {
    if (!input.trim()) return;
    sendMessage({ text: input }, buildRequestOptions());
    setInput("");
  };

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging.current) return;
    const delta = startX.current - e.clientX;
    const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
    const newWidth = Math.min(
      maxWidth,
      Math.max(MIN_WIDTH, startWidth.current + delta),
    );
    setWidth(newWidth);
  }, []);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const handleDragStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div
      className="border-border bg-background relative flex shrink-0 flex-col border-l"
      style={{ width: `${width}px` }}
    >
      <div
        onMouseDown={handleDragStart}
        className="hover:bg-border absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize transition-colors"
      />

      <div className="flex shrink-0 items-center border-b px-4 py-3">
        <span className="text-sm font-medium">Agent</span>
      </div>

      <ChatMessages
        messages={messages}
        isLoading={isLoading}
        onSuggestionClick={handleSuggestionClick}
        suggestions={getSuggestions(pathname ?? "")}
      />

      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSubmit={onSubmit}
        onStop={stop}
      />
    </div>
  );
}

export function AgentPanel() {
  const {
    agentOpen,
    activeCampaignId,
    activeChatId,
    setActiveChatId,
    bumpChatList,
    consumeLoadChat,
  } = useCampaign();
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID());
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [renderKey, setRenderKey] = useState(0);
  const currentChatRef = useRef<string | null>(null);

  // Handle loading a saved chat
  useEffect(() => {
    if (!agentOpen) return;
    const requestedId = consumeLoadChat();
    if (!requestedId) return;
    if (requestedId === currentChatRef.current) return;

    // Load the saved chat
    loadChat(requestedId).then((chat) => {
      if (chat) {
        currentChatRef.current = requestedId;
        setChatId(requestedId);
        setInitialMessages(chat.messages);
        setActiveChatId(requestedId);
        setRenderKey((k) => k + 1);
      }
    });
  }, [agentOpen, consumeLoadChat, setActiveChatId]);

  // When agent panel opens with no active chat, or activeChatId was cleared (New Chat), create a fresh one
  useEffect(() => {
    if (!agentOpen) return;
    if (activeChatId === null && currentChatRef.current !== null) {
      // "New Chat" was requested — reset
      const newId = crypto.randomUUID();
      currentChatRef.current = newId;
      setChatId(newId);
      setInitialMessages([]);
      setActiveChatId(newId);
      setRenderKey((k) => k + 1);
      return;
    }
    if (currentChatRef.current) return; // already have a chat

    const newId = crypto.randomUUID();
    currentChatRef.current = newId;
    setChatId(newId);
    setInitialMessages([]);
    setActiveChatId(newId);
    setRenderKey((k) => k + 1);
  }, [agentOpen, activeChatId, setActiveChatId]);

  const handleChatSaved = useCallback(() => {
    bumpChatList();
  }, [bumpChatList]);

  if (!agentOpen) return null;

  return (
    <AgentPanelInner
      key={`${chatId}-${renderKey}`}
      chatId={chatId}
      initialMessages={initialMessages}
      campaignId={activeCampaignId}
      onChatSaved={handleChatSaved}
    />
  );
}
