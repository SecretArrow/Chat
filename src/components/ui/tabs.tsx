"use client";

import { createContext, useContext, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Context                                                                   */
/* -------------------------------------------------------------------------- */

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  variant: "underline" | "pill";
  idBase: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsCtx() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs subcomponents must be used within <Tabs>");
  return ctx;
}

/* -------------------------------------------------------------------------- */
/*  Root                                                                      */
/* -------------------------------------------------------------------------- */

export interface TabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  variant?: "underline" | "pill";
  className?: string;
  children: React.ReactNode;
}

export function Tabs({
  value: controlled,
  defaultValue,
  onValueChange,
  variant = "underline",
  className,
  children,
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const value = controlled ?? uncontrolled;
  const idBase = useState(() => Math.random().toString(36).slice(2, 9))[0];

  const setValue = useCallback(
    (next: string) => {
      if (controlled === undefined) setUncontrolled(next);
      onValueChange?.(next);
    },
    [controlled, onValueChange],
  );

  return (
    <TabsContext.Provider value={{ value, setValue, variant, idBase }}>
      <div className={cn("w-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*  List                                                                      */
/* -------------------------------------------------------------------------- */

export function TabsList({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { variant } = useTabsCtx();
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1",
        variant === "underline" && "border-b border-border",
        variant === "pill" && "bg-surface-2 p-1 rounded-lg",
        className,
      )}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Trigger                                                                   */
/* -------------------------------------------------------------------------- */

export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({ value, className, children, ...props }: TabsTriggerProps) {
  const ctx = useTabsCtx();
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active ? "active" : "inactive"}
      onClick={() => ctx.setValue(value)}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md",
        ctx.variant === "underline" &&
          cn(
            "-mb-px border-b-2 px-3 py-2",
            active
              ? "border-accent text-text"
              : "border-transparent text-text-muted hover:text-text",
          ),
        ctx.variant === "pill" &&
          cn(
            "px-3 py-1.5",
            active
              ? "bg-surface text-text shadow-sm"
              : "text-text-muted hover:text-text",
          ),
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Content                                                                   */
/* -------------------------------------------------------------------------- */

export interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const ctx = useTabsCtx();
  if (ctx.value !== value) return null;
  return (
    <div
      role="tabpanel"
      className={cn("mt-3 animate-fade-in focus:outline-none", className)}
      {...props}
    >
      {children}
    </div>
  );
}
