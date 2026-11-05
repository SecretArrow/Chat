"use client";

/**
 * ConversationList — switches between DMs / Rooms / Groups lists.
 * Each item shows avatar, name, last message preview (decrypted when
 * possible), time ago, and active highlight.
 */
import { useEffect, useMemo } from "react";
import {
  Globe,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import type { Circle, StorageEntry } from "@/lib/octra/circle";
import {
  decryptDMMessage,
  decryptGroupEntry,
  decryptRoomEntry,
} from "@/lib/octra/circle";
import { decodeCurvePub, precomputeSharedKey, type Identity } from "@/lib/octra/crypto";
import { cn, shortAddress, timeAgo } from "@/lib/utils";
import { Avatar, Badge, EmptyState } from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

interface ConversationListProps {
  section: "messages" | "rooms" | "groups";
  onOpenNew?: () => void;
  className?: string;
}

const kindMap = {
  messages: "dm" as const,
  rooms: "room" as const,
  groups: "group" as const,
};

const kindMeta = {
  dm: {
    icon: <Lock className="h-3 w-3" />,
    label: "E2E",
    badge: "DM",
  },
  room: {
    icon: <Globe className="h-3 w-3" />,
    label: "Room",
    badge: "Room",
  },
  group: {
    icon: <Users className="h-3 w-3" />,
    label: "Group",
    badge: "Group",
  },
};

/** Cached shared-key lookup per DM circle. Keys are circle ids. */
function useSharedKeyForDm(circle: Circle | undefined, identity: Identity | null) {
  return useMemo<Uint8Array | null>(() => {
    if (!circle || circle.kind !== "dm" || !identity) return null;
    const me = circle.members.find((m) => m.address === identity.address);
    const other = circle.members.find((m) => m.address !== identity.address);
    if (!me || !other) return null;
    try {
      return precomputeSharedKey(identity.curveSecretKey, decodeCurvePub(other.curvePub));
    } catch {
      return null;
    }
  }, [circle, identity]);
}

/** Try to decrypt the latest entry's payload for preview. */
const EMPTY_ENTRIES: StorageEntry[] = [];
function usePreviewText(circle: Circle | undefined): string {
  const identity = useChatStore((s) => s.identity);
  const entries = useChatStore((s) =>
    circle ? (s.entries[circle.id] ?? EMPTY_ENTRIES) : EMPTY_ENTRIES,
  );
  const sharedKey = useSharedKeyForDm(circle, identity);

  return useMemo(() => {
    if (!circle || entries.length === 0) return "";
    const last = entries[entries.length - 1];
    if (last.kind === "system") return last.author ? "system event" : "";
    try {
      if (circle.kind === "dm" && sharedKey) {
        const r = decryptDMMessage(last, sharedKey);
        return r?.text ?? "";
      }
      if (circle.kind === "group" && identity) {
        return decryptGroupEntry(last, identity) ?? "";
      }
      if (circle.kind === "room") {
        // decryptRoomEntry is async, but for preview we do a quick sync attempt
        // by deferring — fallback to "Encrypted message"
        return "Encrypted message";
      }
    } catch {
      return "";
    }
    return "";
  }, [circle, entries, sharedKey, identity]);
}

interface ConversationRowProps {
  circle: Circle;
  active: boolean;
  onClick: () => void;
}

function ConversationRow({ circle, active, onClick }: ConversationRowProps) {
  const preview = usePreviewText(circle);
  const meta = kindMeta[circle.kind];
  const myAddress = useChatStore((s) => s.identity?.address);
  const contacts = useChatStore((s) => s.contacts);

  const displayName = useMemo(() => {
    if (circle.kind !== "dm") return circle.name;
    const other = circle.members.find((m) => m.address !== myAddress);
    if (!other) return circle.name;
    const contact = contacts.find((c) => c.address === other.address);
    return contact?.nickname ?? shortAddress(other.address, 8, 6);
  }, [circle, myAddress, contacts]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors",
        active
          ? "bg-accent-soft"
          : "hover:bg-surface-2/70",
      )}
    >
      <Avatar name={displayName} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              active ? "text-accent" : "text-text",
            )}
          >
            {displayName}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-text-faint">
            {timeAgo(circle.lastActivity)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
          <span className="text-text-faint shrink-0 inline-flex items-center gap-0.5">
            {meta.icon}
          </span>
          <span className="truncate text-xs text-text-muted">
            {preview || (circle.description ?? "No messages yet")}
          </span>
        </div>
      </div>
      <span
        className={cn(
          "ml-1 h-1.5 w-1.5 rounded-full bg-accent shrink-0",
          // Unread indicator: show only when not active
          active ? "opacity-0" : "opacity-70",
        )}
        aria-hidden
      />
    </button>
  );
}

export function ConversationList({
  section,
  onOpenNew,
  className,
}: ConversationListProps) {
  const circles = useChatStore((s) => s.circles);
  const view = useChatStore((s) => s.view);
  const setView = useChatStore((s) => s.setView);
  const refreshEntries = useChatStore((s) => s.refreshEntries);
  const [query, setQuery] = useState("");

  // Eager-load entries for circles so previews can decrypt
  useEffect(() => {
    const filtered = circles.filter((c) => c.kind === kindMap[section]);
    filtered.forEach((c) => {
      // Only refresh if not already loaded
      if (!useChatStore.getState().entries[c.id]) {
        refreshEntries(c.id).catch(() => {});
      }
    });
  }, [circles, section, refreshEntries]);

  const filtered = useMemo(() => {
    const want = kindMap[section];
    return circles
      .filter((c) => c.kind === want)
      .filter((c) =>
        query.trim()
          ? c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.id.toLowerCase().includes(query.toLowerCase())
          : true,
      )
      .sort((a, b) => b.lastActivity - a.lastActivity);
  }, [circles, section, query]);

  const activeCircleId =
    view.kind === "app" ? view.activeCircleId : undefined;

  const headingMap = {
    messages: { title: "Direct Messages", icon: <MessageSquare className="h-4 w-4" /> },
    rooms: { title: "Chat Rooms", icon: <Globe className="h-4 w-4" /> },
    groups: { title: "Groups", icon: <Users className="h-4 w-4" /> },
  } as const;
  const heading = headingMap[section];

  const onSelect = (id: string) => {
    if (view.kind !== "app") return;
    setView({ kind: "app", section: view.section, activeCircleId: id });
    refreshEntries(id).catch(() => {});
  };

  return (
    <div className={cn("flex flex-col h-full min-h-0 bg-surface", className)}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-text">
            <span className="text-accent">{heading.icon}</span>
            {heading.title}
            <Badge variant="default" className="ml-1">
              {filtered.length}
            </Badge>
          </h2>
          {onOpenNew && (
            <Button size="sm" variant="ghost" onClick={onOpenNew} aria-label={`New ${heading.title}`}>
              <Plus className="h-4 w-4" />
              New
            </Button>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            className="pl-8"
            aria-label="Search conversations"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <EmptyState
            className="py-10"
            icon={heading.icon}
            title={`No ${heading.title.toLowerCase()} yet`}
            description={
              section === "messages"
                ? "Start an end-to-end encrypted DM with a contact, or paste an Octra address + Curve pub."
                : section === "rooms"
                  ? "Rooms are public — anyone with the room ID and room curve pub can read & post."
                  : "Groups are private — every message is wrapped per-recipient (X25519 ECDH + secretbox)."
            }
            action={
              onOpenNew && (
                <Button size="sm" onClick={onOpenNew}>
                  <Plus className="h-4 w-4" />
                  Start new
                </Button>
              )
            }
          />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((c) => (
              <li key={c.id}>
                <ConversationRow
                  circle={c}
                  active={c.id === activeCircleId}
                  onClick={() => onSelect(c.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export type { ConversationListProps };
// StorageEntry re-export for type-only consumers
export type { StorageEntry };
