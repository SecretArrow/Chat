import { cn } from "@/lib/utils";

export type SpinnerSize = "xs" | "sm" | "md" | "lg";

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: SpinnerSize;
}

const sizeMap: Record<SpinnerSize, string> = {
  xs: "h-3 w-3 border",
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-[3px]",
};

/**
 * Simple loading spinner. Uses currentColor so it inherits text color.
 */
export function Spinner({ size = "md", className, ...rest }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block animate-spin rounded-full border-current border-t-transparent align-middle",
        sizeMap[size],
        className,
      )}
      {...rest}
    />
  );
}
