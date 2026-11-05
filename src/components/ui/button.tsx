import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-fg shadow-sm hover:brightness-110 active:brightness-95",
        secondary:
          "bg-surface-2 text-text hover:bg-surface-2/80 border border-border",
        ghost: "bg-transparent text-text hover:bg-surface-2/70",
        danger: "bg-danger text-white shadow-sm hover:brightness-110 active:brightness-95",
        outline:
          "bg-transparent text-text border border-border-strong hover:bg-surface-2/60",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isIcon = size === "icon";
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading && (
        <Loader2
          className={cn(
            "animate-spin shrink-0",
            isIcon ? "h-4 w-4" : "h-4 w-4",
          )}
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
