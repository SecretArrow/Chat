"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

/**
 * Reusable theme toggle button.
 * Cycles light -> dark -> auto on click when no `cycle` prop.
 * Renders the icon for the *effective* theme (auto resolves via matchMedia).
 */
export function ThemeToggle({
  className,
  size = "icon",
}: {
  className?: string;
  size?: "icon" | "sm" | "md";
}) {
  const { theme, setTheme, mounted } = useTheme();

  // Until mounted, render a stable placeholder so SSR + first paint match.
  const next = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";

  const label =
    theme === "light"
      ? "Light theme — click for dark"
      : theme === "dark"
        ? "Dark theme — click for auto"
        : "Auto theme — click for light";

  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
      className={className}
    >
      {mounted ? (
        <>
          {theme === "light" && <Sun className="size-4" />}
          {theme === "dark" && <Moon className="size-4" />}
          {theme === "auto" && <Monitor className="size-4" />}
        </>
      ) : (
        <Sun className="size-4" />
      )}
    </Button>
  );
}
