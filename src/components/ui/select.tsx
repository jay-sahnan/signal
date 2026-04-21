"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export interface SelectItemDef {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  items: SelectItemDef[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
}

export function Select({
  value,
  onValueChange,
  items,
  placeholder = "Select...",
  className,
  triggerClassName,
  id,
  disabled,
  "aria-label": ariaLabel,
}: SelectProps) {
  const current = items.find((i) => i.value === value);

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "border-input bg-background text-foreground hover:bg-muted/50 focus-visible:ring-ring/50 flex h-8 w-full items-center justify-between gap-2 rounded-lg border px-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50",
          className,
          triggerClassName,
        )}
      >
        <SelectPrimitive.Value>
          {current ? (
            current.label
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon>
          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner sideOffset={4} className="z-50">
          <SelectPrimitive.Popup
            className={cn(
              "bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 max-h-[min(var(--available-height),20rem)] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg p-1 shadow-lg ring-1",
            )}
          >
            <SelectPrimitive.List>
              {items.map((item) => (
                <SelectPrimitive.Item
                  key={item.value}
                  value={item.value}
                  disabled={item.disabled}
                  className={cn(
                    "focus-visible:outline-none data-highlighted:bg-muted data-selected:bg-muted relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-sm data-disabled:pointer-events-none data-disabled:opacity-50",
                  )}
                >
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    <SelectPrimitive.ItemIndicator>
                      <Check className="h-3.5 w-3.5" />
                    </SelectPrimitive.ItemIndicator>
                  </span>
                  <SelectPrimitive.ItemText>
                    {item.label}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
