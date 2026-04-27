"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, Trash2 } from "lucide-react";

import { ChatInput } from "@/components/chat/chat-input";
import { SafeLink } from "@/components/safe-link";
import { Button } from "@/components/ui/button";
import {
  type ChatSummary,
  deleteChat,
  listChats,
} from "@/lib/services/chat-history";
import { createClient } from "@/lib/supabase/client";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ChatPage() {
  const router = useRouter();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const supabase = createClient();
    listChats(supabase, 50)
      .then((data) => {
        if (mountedRef.current) {
          setChats(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onSubmit = () => {
    if (!input.trim()) return;
    // Create a new chat and navigate to it — the text is passed via search param
    // so the new page can auto-send it.
    const id = crypto.randomUUID();
    const params = new URLSearchParams({ q: input });
    router.push(`/chat/${id}?${params.toString()}`);
  };

  return (
    <div className="bg-background flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-12">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold">How can I help?</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Start typing to begin a new conversation, or pick up where you
              left off.
            </p>
          </div>

          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && chats.length === 0 && (
            <div className="text-center">
              <p className="text-muted-foreground text-sm">
                No chats yet. Start one using the box below.
              </p>
            </div>
          )}

          {!loading && chats.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
                Recent chats
              </h3>
              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className="hover:bg-muted/50 group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors"
                >
                  <SafeLink
                    href={`/chat/${chat.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <MessageCircle className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {chat.title}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {timeAgo(chat.updated_at)}
                    </span>
                  </SafeLink>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete chat "${chat.title}"`}
                    className="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0 opacity-60 transition-opacity hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    onClick={(e) => {
                      e.preventDefault();
                      deleteChat(createClient(), chat.id)
                        .then(() =>
                          setChats((prev) =>
                            prev.filter((c) => c.id !== chat.id),
                          ),
                        )
                        .catch(() => {});
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ChatInput
        input={input}
        isLoading={false}
        onInputChange={setInput}
        onSubmit={onSubmit}
        onStop={() => {}}
      />
    </div>
  );
}
