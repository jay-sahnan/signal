"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";

import { useAuth } from "@clerk/nextjs";

import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { createChatTransport } from "@/lib/chat-transport";
import { useCampaign } from "@/lib/campaign-context";
import { toTranscript } from "@/lib/email-skills/swipe-run";
import { useStreaming } from "@/lib/streaming-context";
import { useVoiceRun } from "@/lib/voice-run-context";
import { isNavigablePath } from "@/lib/navigation";
import { saveChat } from "@/lib/services/chat-history";
import { createClient } from "@/lib/supabase/client";

const MIN_WIDTH = 360;
const MAX_WIDTH_RATIO = 0.6;
const DEFAULT_WIDTH = 480;

// When the server ends a turn early (turn time budget / step limit), the
// client resumes the pipeline automatically. Bounded so a pathological loop
// can't burn tokens forever; a manual message resets the counter.
const MAX_AUTO_CONTINUES = 3;

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

  if (pathname.startsWith("/profile")) {
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
      "Connect my Gmail for outreach",
      "What's my current sending setup?",
    ];
  }

  if (pathname.startsWith("/email-skills")) {
    return [
      "What has my voice run picked up so far?",
      "They're all too long",
      "Never open with a compliment",
      "Refine my email voice: be blunter",
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
  if (pathname.startsWith("/profile"))
    return "Profiles page (user seller profiles)";
  if (pathname === "/outreach")
    return "Outreach dashboard (sequences, signal queue, kanban pipeline)";
  if (pathname.startsWith("/outreach/review"))
    return "Email review flow (approving/rejecting AI-drafted outreach emails)";
  if (pathname === "/settings") return "Settings page";
  if (pathname.startsWith("/email-skills"))
    return "Email voice page (the swipe deck: judging drafts to build the voice profile)";
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
  const router = useRouter();
  const { register } = useStreaming();
  const { consumePendingPrompt, pendingPrompt } = useCampaign();
  const {
    run: voiceRun,
    ingest: ingestVoicePart,
    notifyTurnDone: notifyVoiceTurnDone,
  } = useVoiceRun();
  // Mirrored into a ref so buildRequestOptions can read the latest run
  // without changing identity on every swipe.
  const voiceRunRef = useRef(voiceRun);
  useEffect(() => {
    voiceRunRef.current = voiceRun;
  }, [voiceRun]);
  const { userId } = useAuth();
  const consumedNonceRef = useRef<number | null>(null);

  const transport = useMemo(() => createChatTransport(), []);

  // Set when the server cut the turn short (see data-turn-paused in the chat
  // route); consumed in onFinish to fire an automatic continuation.
  const turnPausedRef = useRef(false);
  const autoContinuesRef = useRef(0);
  const [continueTick, setContinueTick] = useState(0);

  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    id: campaignId ? `campaign-${campaignId}` : `global-${chatId}`,
    messages: initialMessages,
    transport,
    onData(part) {
      if (part.type === "data-turn-paused") turnPausedRef.current = true;
      // openPage: the agent takes the user to a page instead of naming a
      // path. Client-side push, so this panel and its chat stay exactly as
      // they are. Transient, so a reloaded chat never re-navigates.
      if (part.type === "data-navigate") {
        const d = (part as { data?: { path?: unknown } }).data;
        if (d && typeof d.path === "string" && isNavigablePath(d.path)) {
          router.push(d.path);
        }
      }
      // Voice drafts and saves ride the stream as transient parts; the run
      // provider applies them so the deck updates while the agent talks.
      if (part.type.startsWith("data-voice-")) {
        ingestVoicePart(part as { type: string; data?: unknown });
      }
    },
    onFinish({ messages: allMessages }) {
      if (userId) {
        saveChat(
          createClient(),
          userId,
          chatId,
          allMessages,
          campaignId ?? undefined,
        );
      }
      if (turnPausedRef.current) {
        turnPausedRef.current = false;
        if (autoContinuesRef.current < MAX_AUTO_CONTINUES) {
          autoContinuesRef.current += 1;
          setContinueTick((tick) => tick + 1);
          // The continuation is about to stream: telling the deck the turn
          // is done here flashed a retryable "came back without drafts"
          // error while the drafts were still on their way.
          return;
        }
      }
      // After the turn settles: if the deck was waiting on drafts that never
      // arrived, this turns the spinner into a retry instead of a hang.
      notifyVoiceTurnDone();
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (isLoading)
      return register(campaignId ? `campaign-${campaignId}` : "agent-panel");
  }, [isLoading, register, campaignId]);

  const buildRequestOptions = useCallback(() => {
    const pageContext = pageContextFromPath(pathname ?? "", campaignId);
    // chatId lets the server persist the conversation even when the tab dies
    // mid-stream and the client-side onFinish save never runs.
    const body: Record<string, unknown> = { pageContext, chatId };
    if (campaignId) body.campaignId = campaignId;
    // The active voice run rides every message while it lasts, so the voice
    // tools always judge the current transcript. Read through a ref: this
    // callback must not change identity on every swipe.
    const run = voiceRunRef.current;
    if (run && !run.finished) {
      body.voiceRun = {
        campaignId: run.campaignId,
        transcript: toTranscript(run),
        queued: Math.min(run.queue.length, 24),
      };
    }
    return { body };
  }, [campaignId, chatId, pathname]);

  // Resume a turn the server paused for time/steps. Runs via effect (not
  // inline in onFinish) so sendMessage/buildRequestOptions are initialized.
  useEffect(() => {
    if (continueTick === 0) return;
    sendMessage(
      { text: "Continue exactly where you left off." },
      buildRequestOptions(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueTick]);

  // Auto-send any prompt queued via openAgentWith(). Keyed on the nonce, not
  // the text: the voice deck queues identical texts many times per run, and
  // each one is a real send. The ref guards StrictMode's double-invoke.
  useEffect(() => {
    if (!pendingPrompt || consumedNonceRef.current === pendingPrompt.nonce) {
      return;
    }
    consumedNonceRef.current = pendingPrompt.nonce;
    const pending = consumePendingPrompt();
    if (pending) {
      autoContinuesRef.current = 0;
      sendMessage({ text: pending }, buildRequestOptions());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const handleSuggestionClick = (text: string) => {
    autoContinuesRef.current = 0;
    sendMessage({ text }, buildRequestOptions());
  };

  const onSubmit = () => {
    if (!input.trim()) return;
    autoContinuesRef.current = 0;
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

      {error && <ChatErrorBanner error={error} onRetry={() => regenerate()} />}

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
