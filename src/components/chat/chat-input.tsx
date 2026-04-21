"use client";

import { useEffect, useRef } from "react";

import { ArrowUp, Paperclip, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  onCsvUpload?: (content: string, fileName: string) => void;
  disabled?: boolean;
}

export function ChatInput({
  input,
  isLoading,
  onInputChange,
  onSubmit,
  onStop,
  onCsvUpload,
  disabled = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasLoadingRef = useRef(false);

  // Auto-focus after streaming ends
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) {
      textareaRef.current?.focus();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading && !disabled) {
        handleSubmit();
      }
    }
  };

  const handleSubmit = () => {
    onSubmit();
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    // Re-focus after submit
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onCsvUpload) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onCsvUpload(reader.result, file.name);
      }
    };
    reader.readAsText(file);
    // Reset so the same file can be re-uploaded
    e.target.value = "";
  };

  return (
    <div className="bg-background border-t p-4">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Upload CSV"
            className="h-[44px] w-[44px] shrink-0"
            disabled={disabled || isLoading}
            onClick={() => fileInputRef.current?.click()}
            title="Upload CSV"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            ref={textareaRef}
            placeholder="Ask Signal anything..."
            className="max-h-[72px] min-h-[44px] resize-none overflow-y-auto text-sm transition-[height] duration-100"
            rows={1}
            value={input}
            disabled={disabled}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 72)}px`;
            }}
          />
          {isLoading ? (
            <Button
              size="icon"
              variant="outline"
              aria-label="Stop generating"
              className="h-[44px] w-[44px] shrink-0"
              onClick={onStop}
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              aria-label="Send message"
              className="h-[44px] w-[44px] shrink-0"
              disabled={disabled || !input.trim()}
              onClick={handleSubmit}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
