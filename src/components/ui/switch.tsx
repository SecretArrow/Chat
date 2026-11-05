"use client";

import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Optional accessible label. */
  label?: string;
  className?: string;
  id?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  label,
  className,
  id,
}: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent/40",
        checked ? "bg-accent" : "bg-border-strong",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
