import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: ButtonProps["variant"];
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  actionLabel,
  onAction,
  actionVariant = "primary",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-text-muted">
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">{title}</p>
        {description && (
          <p className="mx-auto max-w-xs text-sm text-text-muted">{description}</p>
        )}
      </div>
      {actionLabel && onAction && (
        <Button variant={actionVariant} size="sm" onClick={onAction} className="mt-1">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
