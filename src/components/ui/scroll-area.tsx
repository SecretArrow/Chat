import { cn } from "@/lib/utils";

export interface ScrollAreaProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind max-height class, e.g. "max-h-64". */
  maxHeight?: string;
  /** Hide horizontal scrollbar (overflow-x hidden). Default true. */
  verticalOnly?: boolean;
}

/**
 * Thin wrapper around a scrollable div. The project already styles the
 * global ::-webkit-scrollbar in globals.css, so we just set overflow and
 * the container height here.
 */
export function ScrollArea({
  maxHeight = "max-h-72",
  verticalOnly = true,
  className,
  children,
  ...props
}: ScrollAreaProps) {
  return (
    <div
      className={cn(
        "overflow-y-auto overflow-x-hidden",
        !verticalOnly && "overflow-x-auto",
        maxHeight,
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
