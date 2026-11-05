"use client";

import { useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark" | "auto";

const THEME_KEY = "octrachat-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("auto");
  const [mounted, setMounted] = useState(false);

  const applyTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = next === "dark" || (next === "auto" && prefersDark);
    root.classList.toggle("dark", isDark);
  }, []);

  useEffect(() => {
    const stored = (typeof localStorage !== "undefined" &&
      (localStorage.getItem(THEME_KEY) as Theme)) || "auto";
    setThemeState(stored);
    applyTheme(stored);
    setMounted(true);

    if (stored === "auto") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("auto");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [applyTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(THEME_KEY, next);
      }
      applyTheme(next);
    },
    [applyTheme]
  );

  return (
    <ThemeContext.Provider value={{ theme, setTheme, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

import { createContext, useContext } from "react";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
  mounted: boolean;
}>({
  theme: "auto",
  setTheme: () => {},
  mounted: false,
});

export function useTheme() {
  return useContext(ThemeContext);
}
