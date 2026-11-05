"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  /** Show the textual label next to the icon. Default true when `label` is set. */
  showLabel?: boolean;
}

/**
 * Copies `value` to the clipboard on click, then briefly shows a check mark
 * for ~2 seconds before reverting to the copy icon.
 */
export function CopyButton({
  value,
  label = "Copy",
  className,
  showLabel = true,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        /* no-op */
      }
      document.body.removeChild(ta);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        copied
          ? "text-success hover:bg-success/10"
          : "text-text-muted hover:bg-surface-2 hover:text-text",
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {showLabel && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}
