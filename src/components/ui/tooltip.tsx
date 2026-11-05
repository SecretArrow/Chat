import { cn } from "@/lib/utils";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: React.ReactNode;
  side?: TooltipSide;
  /** Optional delay in ms before showing. Default 150. */
  delayMs?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * Pure-CSS hover/focus tooltip. Wraps the trigger in a relative span.
 *
 * The tooltip is hidden via opacity + scale and revealed on hover/focus
 * with a transition. The small arrow is a rotated square pseudo-element.
 */
export function Tooltip({
  content,
  side = "top",
  delayMs = 150,
  className,
  children,
}: TooltipProps) {
  return (
    <span className="relative inline-flex group/tt">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium",
          "bg-text text-bg shadow-md opacity-0 scale-95 transition-all duration-150",
          "group-hover/tt:opacity-100 group-hover/tt:scale-100",
          "group-focus-within/tt:opacity-100 group-focus-within/tt:scale-100",
          side === "top" && "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
          side === "bottom" && "top-full left-1/2 mt-1.5 -translate-x-1/2",
          side === "left" && "right-full top-1/2 mr-1.5 -translate-y-1/2",
          side === "right" && "left-full top-1/2 ml-1.5 -translate-y-1/2",
          className,
        )}
        style={{ transitionDelay: `${delayMs}ms` }}
      >
        {content}
        <span
          aria-hidden
          className={cn(
            "absolute h-1.5 w-1.5 rotate-45 bg-text",
            side === "top" && "bottom-[-3px] left-1/2 -translate-x-1/2",
            side === "bottom" && "top-[-3px] left-1/2 -translate-x-1/2",
            side === "left" && "right-[-3px] top-1/2 -translate-y-1/2",
            side === "right" && "left-[-3px] top-1/2 -translate-y-1/2",
          )}
        />
      </span>
    </span>
  );
}
