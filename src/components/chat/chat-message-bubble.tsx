"use client";

import { memo } from "react";

import type { UIMessage } from "ai";
import { isToolUIPart, getToolName } from "ai";
import { Bot, User } from "lucide-react";

import { Markdown } from "@/components/ui/markdown";
import { ToolCallCard } from "./tool-call-card";

interface ChatMessageBubbleProps {
  message: UIMessage;
  isStreaming?: boolean;
}

function StreamingMarkdown({ text }: { text: string }) {
  // During streaming, render markdown with a subtle fade-in on the container.
  // We can't animate per-sentence because markdown needs the full string.
  return (
    <div className="animate-in fade-in-0 duration-300">
      <Markdown>{text}</Markdown>
    </div>
  );
}

export const ChatMessageBubble = memo(
  function ChatMessageBubble({ message, isStreaming }: ChatMessageBubbleProps) {
    const isUser = message.role === "user";

    if (isUser) {
      const textContent = message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("");

      return (
        <div className="flex justify-end gap-3 animate-in fade-in-0 duration-500">
          <div className="bg-primary text-primary-foreground max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm">
            {textContent && (
              <p className="whitespace-pre-wrap">{textContent}</p>
            )}
          </div>
          <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <User className="text-primary h-4 w-4" />
          </div>
        </div>
      );
    }

    // Render assistant parts in order — interleave text and tool calls
    // so multi-step responses show naturally (text → tool → text → tool → text)
    const parts = message.parts;
    const lastTextIndex = parts.reduce(
      (last, p, i) => (p.type === "text" ? i : last),
      -1,
    );

    const liveViewByToolCall = new Map<string, string>();
    for (const p of parts) {
      if (
        p.type === "data-browserbaseLiveView" &&
        typeof (p as { id?: unknown }).id === "string"
      ) {
        const d = (p as { data?: { url?: unknown } }).data;
        if (d && typeof d.url === "string") {
          liveViewByToolCall.set((p as { id: string }).id, d.url);
        }
      }
    }

    return (
      <div className="flex gap-3 animate-in fade-in-0 duration-500">
        <div className="bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
          <Bot className="text-muted-foreground h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          {parts.map((part, i) => {
            if (isToolUIPart(part)) {
              return (
                <ToolCallCard
                  key={part.toolCallId}
                  toolName={getToolName(part)}
                  state={part.state}
                  input={"input" in part ? part.input : undefined}
                  output={"output" in part ? part.output : undefined}
                  errorText={
                    "errorText" in part ? (part.errorText as string) : undefined
                  }
                  liveViewUrl={liveViewByToolCall.get(part.toolCallId)}
                />
              );
            }

            if (part.type === "text" && part.text) {
              const isLastText = i === lastTextIndex;
              const isActivelyStreaming = isStreaming && isLastText;

              return (
                <div
                  key={`text-${i}`}
                  className="bg-muted/60 my-1 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm"
                >
                  {isActivelyStreaming ? (
                    <StreamingMarkdown text={part.text} />
                  ) : (
                    <Markdown>{part.text}</Markdown>
                  )}
                </div>
              );
            }

            // Skip other part types (step-start, reasoning, etc.)
            return null;
          })}
        </div>
      </div>
    );
  },
  (prev, next) => {
    // During streaming, always re-render the latest assistant message
    if (next.isStreaming) return false;
    // Otherwise only re-render if content changed
    return prev.message === next.message;
  },
);
