"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { SquarePen } from "lucide-react";

import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { Button } from "@/components/ui/button";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { loadChat, saveChat } from "@/lib/services/chat-history";

// ---------------------------------------------------------------------------
// Inner component -- only rendered after initial messages are loaded so that
// useChat initialises with the correct message history.
// ---------------------------------------------------------------------------

function summarizeChat(chatId: string) {
  // Fire-and-forget: use sendBeacon so it survives navigation/tab close
  const body = JSON.stringify({ chatId });
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/chat/summarize",
      new Blob([body], { type: "application/json" }),
    );
  } else {
    fetch("/api/chat/summarize", { method: "POST", body, keepalive: true });
  }
}

function ChatView({
  chatId,
  initialMessages,
  initialTitle,
  autoSendText,
}: {
  chatId: string;
  initialMessages: UIMessage[];
  initialTitle?: string | null;
  autoSendText?: string;
}) {
  const [input, setInput] = useState("");
  const { activeCampaignId } = useCampaign();
  const { register } = useStreaming();
  const didAutoSend = useRef(false);
  const needsSummary = useRef(false);

  const turnCount = useRef(0);

  const { messages, sendMessage, status, stop } = useChat({
    id: chatId,
    messages: initialMessages,
    onFinish({ messages: allMessages }) {
      saveChat(chatId, allMessages, activeCampaignId ?? undefined);
      turnCount.current++;
      // Generate a clean title after the first assistant reply so the chat
      // history doesn't show the raw user message as the title.
      if (turnCount.current === 1) {
        summarizeChat(chatId);
      } else {
        needsSummary.current = true;
      }
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (isLoading) return register("main-chat");
  }, [isLoading, register]);

  // Summarize when user leaves the chat (unmount or tab hidden)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && needsSummary.current) {
        needsSummary.current = false;
        summarizeChat(chatId);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (needsSummary.current) {
        needsSummary.current = false;
        summarizeChat(chatId);
      }
    };
  }, [chatId]);

  // Auto-send the initial query passed via ?q= search param
  const requestOptions = activeCampaignId
    ? { body: { campaignId: activeCampaignId } }
    : undefined;

  useEffect(() => {
    if (autoSendText && !didAutoSend.current) {
      didAutoSend.current = true;
      sendMessage({ text: autoSendText }, requestOptions);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendText]);

  const handleSuggestionClick = (text: string) => {
    sendMessage({ text }, requestOptions);
  };

  const onSubmit = () => {
    if (!input.trim()) return;
    sendMessage({ text: input }, requestOptions);
    setInput("");
  };

  const onCsvUpload = (content: string, fileName: string) => {
    const msg = `I'm uploading a CSV file (${fileName}). Please review the data and help me import it into the active campaign.\n\n\`\`\`csv\n${content}\n\`\`\``;
    sendMessage({ text: msg }, requestOptions);
  };

  const router = useRouter();

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      <div className="border-border flex items-center justify-between gap-2 border-b px-4 py-2">
        <span className="min-w-0 truncate text-sm font-medium">
          {initialTitle?.trim() || "New chat"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Start new chat"
          className="h-8 w-8 shrink-0"
          onClick={() => router.push("/chat")}
        >
          <SquarePen className="h-4 w-4" />
        </Button>
      </div>
      <ChatMessages
        messages={messages}
        isLoading={isLoading}
        onSuggestionClick={handleSuggestionClick}
      />
      <ChatInput
        input={input}
        isLoading={isLoading}
        onInputChange={setInput}
        onSubmit={onSubmit}
        onStop={stop}
        onCsvUpload={onCsvUpload}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer component -- loads chat from DB, then renders ChatView.
// ---------------------------------------------------------------------------

export default function ChatPage() {
  const { id: chatId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const autoSendText = searchParams.get("q") ?? undefined;
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | null>(
    null,
  );
  const [initialTitle, setInitialTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadChat(chatId).then((chat) => {
      if (cancelled) return;
      setInitialMessages(chat?.messages ?? []);
      const title = (chat as { title?: string | null } | null)?.title ?? null;
      setInitialTitle(title);
    });
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  if (initialMessages === null) {
    return (
      <div className="bg-background flex min-h-0 flex-1 items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading chat...</div>
      </div>
    );
  }

  return (
    <ChatView
      chatId={chatId}
      initialMessages={initialMessages}
      initialTitle={initialTitle}
      autoSendText={autoSendText}
    />
  );
}
