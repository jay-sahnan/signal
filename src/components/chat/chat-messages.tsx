"use client";

import { useEffect, useRef } from "react";

import type { UIMessage } from "ai";
import { Loader2, MessageSquare } from "lucide-react";

import { ChatMessageBubble } from "./chat-message-bubble";

import { Button } from "@/components/ui/button";

const DEFAULT_SUGGESTIONS = [
  "Start a new outbound campaign",
  "Find nursing homes in London to contact",
  "Show me my active campaigns",
  "Check for new signals on my prospects",
];

interface ChatMessagesProps {
  messages: UIMessage[];
  isLoading: boolean;
  onSuggestionClick: (text: string) => void;
  suggestions?: string[];
}

export function ChatMessages({
  messages,
  isLoading,
  onSuggestionClick,
  suggestions = DEFAULT_SUGGESTIONS,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Smooth-scroll new user messages into view; streaming content
  // stays pinned via CSS overflow-anchor on the anchor div.
  const prevCountRef = useRef(0);
  useEffect(() => {
    const count = messages.length;
    if (count > prevCountRef.current && count > 0) {
      const el = scrollContainerRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
    prevCountRef.current = count;
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center animate-in fade-in-0 duration-300">
        <div className="max-w-md space-y-6 text-center">
          <div className="bg-muted mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <MessageSquare className="text-muted-foreground h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">How can I help?</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              I&apos;m Signal, your AI assistant. Ask me anything or pick a
              suggestion below.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                className="h-auto py-2 text-xs whitespace-normal transition-colors"
                onClick={() => onSuggestionClick(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
    >
      <div className="min-w-0 space-y-4 p-4" style={{ overflowAnchor: "none" }}>
        {messages.map((message, i) => (
          <ChatMessageBubble
            key={message.id}
            message={message}
            isStreaming={
              isLoading &&
              message.role === "assistant" &&
              i === messages.length - 1
            }
          />
        ))}
        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-3 animate-in fade-in-0 duration-300">
            <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
            </div>
            <div className="bg-muted/60 rounded-2xl rounded-bl-md px-4 py-2.5">
              <div className="flex items-center gap-1.5 py-0.5">
                <span
                  className="bg-muted-foreground/50 h-1.5 w-1.5 rounded-full animate-dot-bounce"
                  style={{ animationDelay: "0ms" }}
                />
                <span
                  className="bg-muted-foreground/50 h-1.5 w-1.5 rounded-full animate-dot-bounce"
                  style={{ animationDelay: "160ms" }}
                />
                <span
                  className="bg-muted-foreground/50 h-1.5 w-1.5 rounded-full animate-dot-bounce"
                  style={{ animationDelay: "320ms" }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Anchor element — browser keeps this in view as content grows */}
      <div
        ref={bottomRef}
        style={{ overflowAnchor: "auto" }}
        className="h-px"
      />
    </div>
  );
}
