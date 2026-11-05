import { cn } from "@/lib/utils";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

export interface AvatarProps {
  /** String to derive initials + color from (address, nickname, name). */
  name: string;
  size?: AvatarSize;
  /** Show a pulsing green online indicator. */
  online?: boolean;
  className?: string;
}

const sizeMap: Record<AvatarSize, { box: string; text: string; dot: string }> = {
  sm: { box: "h-7 w-7", text: "text-[11px]", dot: "h-2 w-2" },
  md: { box: "h-9 w-9", text: "text-xs", dot: "h-2.5 w-2.5" },
  lg: { box: "h-12 w-12", text: "text-sm", dot: "h-3 w-3" },
  xl: { box: "h-18 w-18", text: "text-lg", dot: "h-3.5 w-3.5" },
};

// 8 pleasing, theme-agnostic colors. Used via inline style on a light bg.
// Each pair is [bg, fg].
const palette: Array<[string, string]> = [
  ["#7c5cff", "#ffffff"], // violet (accent-ish)
  ["#10b981", "#ffffff"], // emerald
  ["#f59e0b", "#1f2937"], // amber
  ["#f43f5e", "#ffffff"], // rose
  ["#0ea5e9", "#ffffff"], // sky
  ["#8b5cf6", "#ffffff"], // purple
  ["#ec4899", "#ffffff"], // pink
  ["#14b8a6", "#ffffff"], // teal
];

/** DJB2-ish hash → 0..palette.length-1 */
function hashIndex(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % palette.length;
}

/** Derive 1-2 uppercase initials from a name or Octra address. */
function initials(input: string): string {
  const s = (input ?? "").trim();
  if (!s) return "?";
  // Octra addresses start with "oct" — show last 2 chars uppercased for variety.
  if (/^oct[a-z0-9]+$/i.test(s) && s.length >= 4) {
    return s.slice(2, 4).toUpperCase();
  }
  const parts = s.split(/[\s_.\-@]+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Avatar({ name, size = "md", online, className }: AvatarProps) {
  const s = sizeMap[size];
  const [bg, fg] = palette[hashIndex(name)];
  const text = initials(name);

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none", s.box, className)}
      style={{ backgroundColor: bg, color: fg }}
      aria-hidden
    >
      <span className={cn("leading-none", s.text)}>{text}</span>
      {online && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full bg-success ring-2 ring-surface animate-pulse-dot",
            s.dot,
          )}
        />
      )}
    </span>
  );
}
