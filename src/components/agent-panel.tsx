"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { saveChat } from "@/lib/services/chat-history";

const MIN_WIDTH = 360;
const MAX_WIDTH_RATIO = 0.6;
const DEFAULT_WIDTH = 480;

function getSuggestions(pathname: string, campaignId: string | null): string[] {
  if (campaignId && pathname.startsWith("/campaigns/")) {
    return [
      "Find more companies matching my ICP",
      "Search for decision-makers at the top companies",
      "Summarize this campaign's progress",
      "Set up outreach for my top contacts",
    ];
  }

  if (pathname === "/outreach") {
    return [
      "Show me the status of my active sequences",
      "Set up a new outreach sequence",
      "How many contacts are waiting for signals?",
      "Send all approved drafts for my campaign",
    ];
  }

  if (pathname.startsWith("/outreach/review")) {
    return [
      "Rewrite this email to be shorter",
      "Make the subject line more compelling",
      "Add a specific signal reference to this draft",
      "Approve all remaining drafts",
    ];
  }

  if (pathname === "/signals") {
    return [
      "Create a new signal to track",
      "Show me all available signals",
      "Test a signal against my companies",
      "Which signals should I enable for my campaign?",
    ];
  }

  if (pathname === "/tracking") {
    return [
      "Show me recent tracking changes",
      "Set up tracking for all qualified companies",
      "Which companies had hiring changes this week?",
      "Adjust my tracking thresholds",
    ];
  }

  if (pathname === "/profile") {
    return [
      "Update my profile with my company details",
      "Create a new profile for a different offering",
      "Show me all my profiles",
      "Link a profile to my campaign",
    ];
  }

  if (pathname === "/settings") {
    return [
      "Help me configure my email settings",
      "Show me my API usage costs",
      "Set up my AgentMail inbox",
      "What's my current sending setup?",
    ];
  }

  if (pathname === "/" || pathname === "") {
    return [
      "Show me my campaign performance",
      "Which contacts have replied recently?",
      "What signals fired this week?",
      "Start a new outbound campaign",
    ];
  }

  // Default global suggestions
  return [
    "Find SaaS companies in London",
    "Search for AI startups on Y Combinator",
    "Check hiring activity for stripe.com",
    "Start a new outbound campaign",
  ];
}

function pageContextFromPath(
  pathname: string,
  campaignId: string | null,
): string {
  if (!pathname) return "Unknown page";
  if (pathname === "/" || pathname === "") return "Overview dashboard";
  if (pathname === "/signals")
    return "Signals library (browse, toggle, create signals)";
  if (pathname === "/tracking")
    return "Tracking page (monitored companies and signal history)";
  if (pathname === "/profile") return "Profiles page (user seller profiles)";
  if (pathname === "/outreach")
    return "Outreach dashboard (sequences, signal queue, kanban pipeline)";
  if (pathname.startsWith("/outreach/review"))
    return "Email review flow (approving/rejecting AI-drafted outreach emails)";
  if (pathname === "/settings") return "Settings page";
  if (pathname === "/chat") return "Chat home (recent conversations)";
  if (pathname.startsWith("/chat/")) return "Inside a specific chat thread";
  if (pathname.startsWith("/campaigns/") && campaignId) {
    return `Campaign detail for campaign ${campaignId}`;
  }
  if (pathname.startsWith("/campaigns")) return "Campaigns list";
  return `Page: ${pathname}`;
}

interface AgentPanelInnerProps {
  chatId: string;
  initialMessages: UIMessage[];
  campaignId: string | null;
}

function AgentPanelInner({
  chatId,
  initialMessages,
  campaignId,
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
    id: campaignId ? `campaign-${campaignId}` : `global-${chatId}`,
    messages: initialMessages,
    onFinish({ messages: allMessages }) {
      saveChat(chatId, allMessages, campaignId ?? undefined);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (isLoading)
      return register(campaignId ? `campaign-${campaignId}` : "agent-panel");
  }, [isLoading, register, campaignId]);

  const buildRequestOptions = useCallback(() => {
    const pageContext = pageContextFromPath(pathname ?? "", campaignId);
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
        <span className="text-sm font-medium">
          {campaignId ? "Campaign Agent" : "Agent"}
        </span>
      </div>

      <ChatMessages
        messages={messages}
        isLoading={isLoading}
        onSuggestionClick={handleSuggestionClick}
        suggestions={getSuggestions(pathname ?? "", campaignId)}
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
  const { agentOpen, activeCampaignId } = useCampaign();
  const [loaded, setLoaded] = useState(false);
  const [chatId, setChatId] = useState<string>("");
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const loadKeyRef = useRef<string | null>(null);

  // Always start a fresh chat when the panel opens — past history bloats context and cost.
  useEffect(() => {
    if (!agentOpen) {
      loadKeyRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoaded(false);
      return;
    }
    const key = activeCampaignId ?? "__global__";
    if (loadKeyRef.current === key) return;
    loadKeyRef.current = key;

    setChatId(crypto.randomUUID());
    setInitialMessages([]);
    setLoaded(true);
  }, [agentOpen, activeCampaignId]);

  if (!agentOpen) return null;

  if (!loaded) {
    return (
      <div
        className="border-border bg-background relative flex shrink-0 items-center justify-center border-l"
        style={{ width: `${DEFAULT_WIDTH}px` }}
      >
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <AgentPanelInner
      key={activeCampaignId ?? "__global__"}
      chatId={chatId}
      initialMessages={initialMessages}
      campaignId={activeCampaignId}
    />
  );
}
