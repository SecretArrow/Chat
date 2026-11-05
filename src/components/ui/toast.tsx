"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { create } from "zustand";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  /** Override auto-dismiss duration in ms. 0 = sticky. Default 4000. */
  duration?: number;
}

export interface ToastInput {
  type?: ToastType;
  title: string;
  description?: string;
  duration?: number;
}

/* -------------------------------------------------------------------------- */
/*  Zustand store                                                             */
/* -------------------------------------------------------------------------- */

interface ToastStore {
  toasts: ToastItem[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (input) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    const item: ToastItem = {
      id,
      type: input.type ?? "info",
      title: input.title,
      description: input.description,
      duration: input.duration ?? 4000,
    };
    set((s) => ({ toasts: [...s.toasts, item] }));
    if (item.duration && item.duration > 0) {
      setTimeout(() => get().dismiss(id), item.duration);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/* -------------------------------------------------------------------------- */
/*  Hook                                                                      */
/* -------------------------------------------------------------------------- */

export interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  custom: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const ToastApiContext = createContext<ToastApi | null>(null);

/**
 * Returns the toast API. Must be used inside a <ToastProvider>.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastApiContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider>");
  }
  return ctx;
}

/* -------------------------------------------------------------------------- */
/*  Provider                                                                  */
/* -------------------------------------------------------------------------- */

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const push = useToastStore((s) => s.push);
  const dismiss = useToastStore((s) => s.dismiss);
  const clear = useToastStore((s) => s.clear);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) =>
        push({ type: "success", title, description }),
      error: (title, description) =>
        push({ type: "error", title, description, duration: 6000 }),
      info: (title, description) => push({ type: "info", title, description }),
      warning: (title, description) =>
        push({ type: "warning", title, description }),
      custom: (input) => push(input),
      dismiss,
      clear,
    }),
    [push, dismiss, clear],
  );

  return (
    <ToastApiContext.Provider value={api}>
      {children}
      <ToastViewport />
    </ToastApiContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Viewport                                                                  */
/* -------------------------------------------------------------------------- */

const typeStyles: Record<
  ToastType,
  { icon: typeof Info; ring: string; iconColor: string }
> = {
  success: { icon: CheckCircle2, ring: "border-success/40", iconColor: "text-success" },
  error: { icon: AlertCircle, ring: "border-danger/40", iconColor: "text-danger" },
  warning: { icon: AlertTriangle, ring: "border-warning/40", iconColor: "text-warning" },
  info: { icon: Info, ring: "border-accent/40", iconColor: "text-accent" },
};

function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed top-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => {
        const s = typeStyles[t.type];
        const Icon = s.icon;
        return (
          <ToastItemView
            key={t.id}
            item={t}
            icon={Icon}
            ring={s.ring}
            iconColor={s.iconColor}
            onDismiss={() => dismiss(t.id)}
          />
        );
      })}
    </div>
  );
}

function ToastItemView({
  item,
  icon: Icon,
  ring,
  iconColor,
  onDismiss,
}: {
  item: ToastItem;
  icon: typeof Info;
  ring: string;
  iconColor: string;
  onDismiss: () => void;
}) {
  // Mount/unmount animation: fade-in on mount, fade-out on dismiss.
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDismiss = () => {
    if (leaving) return;
    setLeaving(true);
    timerRef.current = setTimeout(onDismiss, 180);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-start gap-3 rounded-card border bg-surface px-4 py-3 shadow-lg",
        ring,
        "animate-fade-in transition-all duration-150",
        leaving && "opacity-0 translate-y-[-4px]",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconColor)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-xs text-text-muted">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        className="rounded p-0.5 text-text-faint hover:bg-surface-2 hover:text-text transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
