"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const modalSizes = cva("w-full", {
  variants: {
    size: {
      sm: "max-w-sm",
      md: "max-w-md",
      lg: "max-w-lg",
      xl: "max-w-2xl",
    },
  },
  defaultVariants: { size: "md" },
});

export interface ModalProps extends VariantProps<typeof modalSizes> {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  footer?: React.ReactNode;
  /** When false, the close (X) button is hidden. Default true. */
  showClose?: boolean;
  /** When false, clicking the backdrop does not close. Default true. */
  closeOnBackdrop?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  showClose = true,
  closeOnBackdrop = true,
  size,
  className,
  children,
}: ModalProps) {
  // Lock body scroll + Escape-to-close while mounted.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-4"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={closeOnBackdrop ? onClose : undefined}
      />
      <div
        className={cn(
          "relative z-10 glass-strong rounded-card border border-border shadow-xl",
          "w-full translate-y-0 animate-fade-in",
          modalSizes({ size }),
          className,
        )}
      >
        {(title || showClose) && (
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              {title && (
                <h2 className="text-base font-semibold text-text truncate">{title}</h2>
              )}
              {description && (
                <p className="mt-0.5 text-sm text-text-muted">{description}</p>
              )}
            </div>
            {showClose && (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded-md p-1 text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        <div className="px-5 py-4 text-text">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
