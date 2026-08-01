"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { SquarePen } from "lucide-react";

import { useAuth } from "@clerk/nextjs";
import { toast } from "sonner";

import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { createChatTransport } from "@/lib/chat-transport";
import { Button } from "@/components/ui/button";
import { useCampaign } from "@/lib/campaign-context";
import { useStreaming } from "@/lib/streaming-context";
import { loadChat, saveChat } from "@/lib/services/chat-history";
import { createClient } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api-fetch";
import { mapColumns, parseCSV } from "@/lib/csv/company-csv";

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
    apiFetch("/api/chat/summarize", { method: "POST", body, keepalive: true });
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
  const { userId } = useAuth();
  const didAutoSend = useRef(false);
  const needsSummary = useRef(false);

  const turnCount = useRef(0);

  const transport = useMemo(() => createChatTransport(), []);

  const { messages, sendMessage, status, stop, error, regenerate } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onFinish({ messages: allMessages }) {
      if (userId) {
        saveChat(
          createClient(),
          userId,
          chatId,
          allMessages,
          activeCampaignId ?? undefined,
        );
      }
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

  // chatId lets the server persist the conversation even when the tab dies
  // mid-stream and the client-side onFinish save never runs.
  const requestOptions = {
    body: activeCampaignId
      ? { chatId, campaignId: activeCampaignId }
      : { chatId },
  };

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

  // CSV uploads become a target account list (server-side), not pasted CSV in
  // the chat context. The agent only receives a one-line receipt with the
  // list ID and works the list through the target-list tools.
  const onCsvUpload = async (content: string, fileName: string) => {
    const { headers, rows } = parseCSV(content);
    if (headers.length === 0 || rows.length === 0) {
      toast.error("No rows found in that CSV");
      return;
    }
    const accounts = mapColumns(headers, rows);
    const listName = fileName.replace(/\.[^./\\]+$/, "").trim() || fileName;

    let listId: string;
    try {
      const res = await apiFetch("/api/target-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: listName, original_filename: fileName }),
      });
      const data = (await res.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.id) {
        throw new Error(data?.error ?? "Failed to create the target list");
      }
      listId = data.id;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create the target list",
      );
      return;
    }

    const BATCH_SIZE = 500;
    const totalBatches = Math.ceil(accounts.length / BATCH_SIZE);
    const totals = { imported: 0, skipped: 0, failed: 0, peopleImported: 0 };
    const progressToastId =
      totalBatches > 1
        ? toast.loading(`Importing ${accounts.length} rows...`)
        : undefined;

    for (let i = 0; i < totalBatches; i++) {
      const batch = accounts.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
      if (progressToastId !== undefined) {
        toast.loading(`Importing batch ${i + 1} of ${totalBatches}...`, {
          id: progressToastId,
        });
      }
      try {
        const res = await apiFetch(`/api/target-lists/${listId}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });
        if (!res.ok) throw new Error();
        const result = (await res.json()) as {
          imported?: number;
          skipped?: number;
          failed?: number;
          peopleImported?: number;
        };
        totals.imported += result.imported ?? 0;
        totals.skipped += result.skipped ?? 0;
        totals.failed += result.failed ?? 0;
        totals.peopleImported += result.peopleImported ?? 0;
      } catch {
        totals.failed += batch.length;
      }
    }

    if (progressToastId !== undefined) toast.dismiss(progressToastId);

    if (totals.imported === 0 && totals.skipped === 0) {
      toast.error("Import failed", {
        description: "No rows could be imported. Check the file and try again.",
      });
      return;
    }

    let text = `I've uploaded a target account list "${fileName}" — ${totals.imported} companies imported (${totals.skipped} duplicates skipped), list ID ${listId}.`;
    if (totals.peopleImported > 0) {
      text += ` The file also included ${totals.peopleImported} contacts, now attached to their accounts.`;
    }
    if (totals.failed > 0) {
      text += ` Note: ${totals.failed} rows failed to import.`;
    }
    text += " Please help me work this list.";
    sendMessage({ text }, requestOptions);
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
      {error && <ChatErrorBanner error={error} onRetry={() => regenerate()} />}
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
    loadChat(createClient(), chatId).then((chat) => {
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
