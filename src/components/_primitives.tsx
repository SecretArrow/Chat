/**
 * Self-contained UI primitives for OctraChat app shell.
 * ------------------------------------------------------------------
 * These wrap the bare-minimum set of UI elements needed by the
 * messenger components. They use the project's Tailwind design tokens
 * (bg-bg, bg-surface, text-text, bg-accent, etc.) and lucide icons.
 *
 * Why self-contained? Another subagent is building a fuller shadcn-style
 * UI set in `src/components/ui/` in parallel. To avoid coupling my code
 * to that subagent's exact API (and avoid tsc errors), the messenger
 * components use these local primitives. Existing Button / Input /
 * Textarea / Spinner from `@/components/ui` are reused.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Check, ChevronDown, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Modal                                                                     */
/* -------------------------------------------------------------------------- */

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const modalSizeMap: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        className={cn(
          "relative w-full rounded-xl glass-strong border border-border shadow-lg",
          "animate-fade-in flex flex-col max-h-[90vh]",
          modalSizeMap[size],
          className,
        )}
      >
        {(title || description) && (
          <div className="px-5 pt-5 pb-3 border-b border-border">
            {title && (
              <h2 className="text-base font-semibold text-text">{title}</h2>
            )}
            {description && (
              <p className="mt-1 text-sm text-text-muted">{description}</p>
            )}
          </div>
        )}
        <button
          type="button"
          aria-label="Close"
          className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text transition-colors"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Drawer (slide-in from right)                                              */
/* -------------------------------------------------------------------------- */

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  width?: string;
  side?: "left" | "right";
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = "max-w-md",
  side = "right",
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onOpenChange]);

  const sideClass =
    side === "left"
      ? "left-0 top-0 bottom-0 border-r"
      : "right-0 top-0 bottom-0 border-l";
  const transformClass = open
    ? "translate-x-0"
    : side === "left"
      ? "-translate-x-full"
      : "translate-x-full";

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 transition-opacity duration-200",
        open ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      role="dialog"
      aria-modal="true"
      aria-hidden={!open}
    >
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        className={cn(
          "absolute w-full glass-strong border-border shadow-xl flex flex-col transition-transform duration-200",
          sideClass,
          width,
          transformClass,
        )}
      >
        {(title || description) && (
          <div className="px-5 pt-5 pb-3 border-b border-border flex items-start justify-between gap-3">
            <div>
              {title && (
                <h2 className="text-base font-semibold text-text">{title}</h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-text-muted">{description}</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Close"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text transition-colors shrink-0"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Badge                                                                     */
/* -------------------------------------------------------------------------- */

type BadgeVariant = "default" | "accent" | "success" | "warning" | "danger" | "outline";

const badgeVariantMap: Record<BadgeVariant, string> = {
  default: "bg-surface-2 text-text-muted border border-border",
  accent: "bg-accent-soft text-accent border border-accent/20",
  success: "bg-success/10 text-success border border-success/20",
  warning: "bg-warning/10 text-warning border border-warning/20",
  danger: "bg-danger/10 text-danger border border-danger/20",
  outline: "bg-transparent text-text-muted border border-border-strong",
};

export interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        badgeVariantMap[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Card                                                                      */
/* -------------------------------------------------------------------------- */

export interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl bg-surface border border-border shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border",
        className,
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        {icon && <div className="text-accent shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text truncate">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-text-muted">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/*  Tabs                                                                      */
/* -------------------------------------------------------------------------- */

export interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  children,
  className,
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const value = controlled ?? internal;
  const setValue = useCallback(
    (v: string) => {
      if (controlled === undefined) setInternal(v);
      onValueChange?.(v);
    },
    [controlled, onValueChange],
  );
  const ctx = useMemo(() => ({ value, setValue }), [value, setValue]);
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-lg bg-surface-2 p-1 border border-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger must be inside Tabs");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap",
        active
          ? "bg-surface text-text shadow-sm"
          : "text-text-muted hover:text-text",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent must be inside Tabs");
  if (ctx.value !== value) return null;
  return <div className={cn("animate-fade-in", className)}>{children}</div>;
}

/* -------------------------------------------------------------------------- */
/*  Tooltip (simple, hover/focus)                                             */
/* -------------------------------------------------------------------------- */

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [shown, setShown] = useState(false);
  const sideClass =
    side === "top"
      ? "bottom-full mb-1.5 left-1/2 -translate-x-1/2"
      : side === "bottom"
        ? "top-full mt-1.5 left-1/2 -translate-x-1/2"
        : side === "left"
          ? "right-full mr-1.5 top-1/2 -translate-y-1/2"
          : "left-full ml-1.5 top-1/2 -translate-y-1/2";

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
    >
      {children}
      {shown && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50 rounded-md bg-black px-2 py-1 text-xs text-white shadow-md whitespace-nowrap pointer-events-none",
            sideClass,
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Switch                                                                    */
/* -------------------------------------------------------------------------- */

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        checked ? "bg-accent" : "bg-surface-2 border border-border",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      {...rest}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Select (native-styled for reliability)                                    */
/* -------------------------------------------------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  id,
  ...rest
}: SelectProps) {
  return (
    <div
      className={cn(
        "relative inline-flex items-center",
        disabled && "opacity-60",
        className,
      )}
    >
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
        className={cn(
          "appearance-none w-full rounded-md border border-border bg-surface pl-3 pr-8 py-2 text-sm text-text",
          "focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors cursor-pointer",
        )}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 h-4 w-4 text-text-muted"
        aria-hidden
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  ScrollArea                                                                */
/* -------------------------------------------------------------------------- */

export function ScrollArea({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-y-auto", className)} style={{ scrollbarGutter: "stable" }}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  EmptyState                                                                */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-12",
        className,
      )}
    >
      {icon && (
        <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-text-muted">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  CopyButton                                                                */
/* -------------------------------------------------------------------------- */

export interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
  variant?: "ghost" | "outline" | "primary";
}

export function CopyButton({
  value,
  label = "Copy",
  className,
  size = "sm",
  variant = "ghost",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may not be available
    }
  }, [value]);

  const variantClass =
    variant === "primary"
      ? "bg-accent text-accent-fg hover:brightness-110"
      : variant === "outline"
        ? "border border-border-strong text-text hover:bg-surface-2/60"
        : "text-text-muted hover:text-text hover:bg-surface-2/70";

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
        size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm",
        variantClass,
        className,
      )}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" /> {label}
        </>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Avatar (initials-based)                                                   */
/* -------------------------------------------------------------------------- */

const avatarPalette = [
  "bg-accent text-accent-fg",
  "bg-success/20 text-success",
  "bg-warning/20 text-warning",
  "bg-danger/20 text-danger",
  "bg-accent-soft text-accent",
];

export interface AvatarProps {
  name: string;
  src?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const avatarSizeMap: Record<NonNullable<AvatarProps["size"]>, string> = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-16 w-16 text-lg",
};

function initialsFromName(name: string): string {
  if (!name) return "?";
  const cleaned = name.replace(/^oct/, "").replace(/^cp_/, "").trim();
  if (/^[a-zA-Z]/.test(cleaned)) {
    const parts = cleaned.split(/[\s_-]+/).filter(Boolean).slice(0, 2);
    if (parts.length === 0) return cleaned.slice(0, 2).toUpperCase();
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
  }
  // For addresses, use last 2 chars
  return cleaned.slice(-2).toUpperCase();
}

function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return avatarPalette[Math.abs(hash) % avatarPalette.length];
}

export function Avatar({ name, src, size = "md", className }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const showImg = src && !imgError;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden font-semibold select-none",
        avatarSizeMap[size],
        !showImg && colorFromName(name),
        className,
      )}
      aria-label={name}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span>{initialsFromName(name)}</span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Toast (lightweight)                                                       */
/* -------------------------------------------------------------------------- */

type ToastVariant = "default" | "success" | "danger" | "warning";

export interface ToastOptions {
  title?: string;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, "description">> {
  id: string;
  description?: React.ReactNode;
}

interface ToastContextValue {
  toasts: ToastItem[];
  toast: (opts: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (opts: ToastOptions) => {
      const id = Math.random().toString(36).slice(2, 9);
      const item: ToastItem = {
        id,
        title: opts.title ?? "",
        description: opts.description,
        variant: opts.variant ?? "default",
        duration: opts.duration ?? 4000,
      };
      setToasts((cur) => [...cur, item]);
      setTimeout(() => dismiss(id), item.duration);
    },
    [dismiss],
  );

  const ctx = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const toastVariantBorder: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-success/40",
  danger: "border-danger/40",
  warning: "border-warning/40",
};

const toastVariantIconColor: Record<ToastVariant, string> = {
  default: "text-text-muted",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
};

function ToastViewport({
  toasts,
  dismiss,
}: {
  toasts: ToastItem[];
  dismiss: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-96">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "glass-strong rounded-lg border shadow-lg px-4 py-3 flex items-start gap-3 animate-fade-in",
            toastVariantBorder[t.variant],
          )}
        >
          <div className={cn("mt-0.5 shrink-0", toastVariantIconColor[t.variant])}>
            <span className="inline-block h-2 w-2 rounded-full bg-current animate-pulse-dot" />
          </div>
          <div className="flex-1 min-w-0">
            {t.title && (
              <p className="text-sm font-medium text-text">{t.title}</p>
            )}
            {t.description && (
              <p className="mt-0.5 text-xs text-text-muted break-words">
                {t.description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="shrink-0 text-text-faint hover:text-text transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Safe no-op fallback so components can render outside provider
    return {
      toast: (_opts: ToastOptions) => {},
      toasts: [] as ToastItem[],
      dismiss: (_id: string) => {},
    };
  }
  return ctx;
}

/* -------------------------------------------------------------------------- */
/*  Field (label + helper + control wrapper)                                  */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  htmlFor,
  helperText,
  error,
  required,
  children,
  className,
}: {
  label?: React.ReactNode;
  htmlFor?: string;
  helperText?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div className={cn("w-full", className)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-text">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-danger">{error}</p>
      ) : helperText ? (
        <p className="mt-1.5 text-xs text-text-muted">{helperText}</p>
      ) : null}
    </div>
  );
}
