"use client";

/**
 * AppShell — authenticated 3-pane messenger layout.
 *
 * Desktop (md+): persistent 3-pane layout:
 *   [ narrow sidebar | conversation list | active view ]
 *
 * Mobile: single pane at a time:
 *   - Sidebar as a slide-in drawer (hamburger button)
 *   - List view for the active section
 *   - Chat view replaces list when a circle is selected
 *
 * Sidebar sections: Messages, Rooms, Groups, Contacts, Stealth Inbox, Wallet.
 * Bottom of sidebar: network selector, RPC health dot, theme toggle, lock button.
 */
import { useEffect, useMemo, useState } from "react";
import {
  EyeOff,
  Globe,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  Shield,
  Sun,
  Users,
  Vote,
  Wallet,
  X,
} from "lucide-react";
import { useChatStore, type AppView } from "@/stores/chat-store";
import { useTheme } from "@/components/theme-provider";
import type { OctraNetwork } from "@/lib/octra/rpc";
import { OctraRpcClient } from "@/lib/octra/rpc";
import { encodeCurvePub } from "@/lib/octra/crypto";
import { cn, shortAddress } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Drawer,
  Select,
  Tooltip,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatWindow } from "@/components/chat/chat-window";
import { NewChatModal } from "@/components/chat/new-chat-modal";
import { ContactsView } from "@/components/contacts/contacts-view";
import { StealthInbox } from "@/components/stealth/stealth-inbox";
import { WalletView } from "@/components/wallet/wallet-view";

type Section = "messages" | "rooms" | "groups" | "contacts" | "stealth" | "wallet";

const SECTION_ITEMS: {
  id: Section;
  label: string;
  icon: React.ReactNode;
  hint: string;
}[] = [
  { id: "messages", label: "Messages", icon: <MessageSquare className="h-4 w-4" />, hint: "End-to-end encrypted DMs" },
  { id: "rooms", label: "Rooms", icon: <Globe className="h-4 w-4" />, hint: "Public chat rooms" },
  { id: "groups", label: "Groups", icon: <Users className="h-4 w-4" />, hint: "Private per-recipient groups" },
  { id: "contacts", label: "Contacts", icon: <Users className="h-4 w-4" />, hint: "Saved Octra addresses" },
  { id: "stealth", label: "Stealth Inbox", icon: <EyeOff className="h-4 w-4" />, hint: "Anonymous one-time DMs" },
  { id: "wallet", label: "Wallet", icon: <Wallet className="h-4 w-4" />, hint: "Identity, network, settings" },
];

const NETWORK_OPTIONS = [
  { value: "devnet", label: "Devnet" },
  { value: "mainnet", label: "Mainnet" },
];

export function AppShell() {
  const view = useChatStore((s) => s.view);
  const setView = useChatStore((s) => s.setView);
  const identity = useChatStore((s) => s.identity);
  const network = useChatStore((s) => s.network);
  const setNetwork = useChatStore((s) => s.setNetwork);
  const rpcHealthy = useChatStore((s) => s.rpcHealthy);
  const circles = useChatStore((s) => s.circles);
  const lock = useChatStore((s) => s.lock);
  const { theme, setTheme } = useTheme();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatTab, setNewChatTab] = useState<"dm" | "room" | "group">("dm");

  // Default to messages section if view is malformed
  const section: Section = view.kind === "app" ? view.section : "messages";
  const activeCircleId = view.kind === "app" ? view.activeCircleId : undefined;

  // Set RPC health on network change
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const client = new OctraRpcClient({ network: network as OctraNetwork });
        const ok = await client.ping();
        if (!cancelled) {
          useChatStore.setState({ rpcHealthy: ok });
        }
      } catch {
        if (!cancelled) {
          useChatStore.setState({ rpcHealthy: false });
        }
      }
    };
    ping();
    return () => {
      cancelled = true;
    };
  }, [network]);

  const myCurvePub = useMemo(
    () => (identity ? encodeCurvePub(identity.curvePublicKey) : ""),
    [identity],
  );

  const goToSection = (s: Section) => {
    setView({ kind: "app", section: s });
    setSidebarOpen(false);
  };

  const onOpenNew = (tab: "dm" | "room" | "group") => {
    setNewChatTab(tab);
    setNewChatOpen(true);
  };

  // For mobile: determine which pane is currently active
  const showChatOnMobile = !!activeCircleId && (section === "messages" || section === "rooms" || section === "groups");

  const backToList = () => {
    if (view.kind !== "app") return;
    setView({ kind: "app", section: view.section });
  };

  if (!identity) {
    return null;
  }

  const renderMiddlePane = () => {
    switch (section) {
      case "messages":
        return <ConversationList section="messages" onOpenNew={() => onOpenNew("dm")} />;
      case "rooms":
        return <ConversationList section="rooms" onOpenNew={() => onOpenNew("room")} />;
      case "groups":
        return <ConversationList section="groups" onOpenNew={() => onOpenNew("group")} />;
      case "contacts":
        return <ContactsView />;
      case "stealth":
        return <StealthInbox />;
      case "wallet":
        return <WalletView />;
    }
  };

  const renderRightPane = () => {
    if (section === "contacts" || section === "stealth" || section === "wallet") {
      // No right chat pane for these — middle pane is full-width
      return null;
    }
    if (!activeCircleId) {
      return null;
    }
    return <ChatWindow circleId={activeCircleId} onBack={backToList} />;
  };

  const rightPane = renderRightPane();
  // For non-chat sections (contacts/stealth/wallet), the middle pane takes full width.
  const middleTakesFull = section === "contacts" || section === "stealth" || section === "wallet";

  // Counters for badges
  const counts = {
    messages: circles.filter((c) => c.kind === "dm").length,
    rooms: circles.filter((c) => c.kind === "room").length,
    groups: circles.filter((c) => c.kind === "group").length,
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-bg overflow-hidden">
      {/* Mobile top bar */}
      <header className="md:hidden glass border-b border-border px-3 py-2 flex items-center gap-2 shrink-0">
        <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <Menu className="h-4 w-4" />
        </Button>
        <Brand compact />
        <div className="ml-auto flex items-center gap-1.5">
          <RpcDot />
        </div>
      </header>

      {/* Main 3-pane container */}
      <div className="flex-1 min-h-0 flex">
        {/* Desktop sidebar (persistent) */}
        <aside className="hidden md:flex w-16 lg:w-64 shrink-0 flex-col bg-surface border-r border-border">
          <SidebarContent
            section={section}
            onSelect={goToSection}
            counts={counts}
            onOpenNew={onOpenNew}
          />
          <SidebarFooter
            network={network as OctraNetwork}
            onNetworkChange={(n) => setNetwork(n as OctraNetwork)}
            rpcHealthy={rpcHealthy}
            theme={theme}
            onThemeChange={setTheme}
            onLock={lock}
            address={identity.address}
            curvePub={myCurvePub}
            label={useChatStore.getState().wallets.find((w) => w.address === identity.address)?.label ?? "Wallet"}
          />
        </aside>

        {/* Mobile sidebar drawer */}
        <Drawer open={sidebarOpen} onOpenChange={setSidebarOpen} width="max-w-xs" side="left">
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
              <Brand />
              <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <SidebarContent
              section={section}
              onSelect={goToSection}
              counts={counts}
              onOpenNew={(t) => {
                setSidebarOpen(false);
                onOpenNew(t);
              }}
              compact
            />
            <SidebarFooter
              network={network as OctraNetwork}
              onNetworkChange={(n) => setNetwork(n as OctraNetwork)}
              rpcHealthy={rpcHealthy}
              theme={theme}
              onThemeChange={setTheme}
              onLock={() => {
                setSidebarOpen(false);
                lock();
              }}
              address={identity.address}
              curvePub={myCurvePub}
              label={useChatStore.getState().wallets.find((w) => w.address === identity.address)?.label ?? "Wallet"}
            />
          </div>
        </Drawer>

        {/* Middle pane */}
        <section
          className={cn(
            "min-h-0 flex flex-col border-r border-border",
            // On mobile, hide when chat is open. On desktop, hide when section takes full width.
            showChatOnMobile ? "hidden md:flex" : "flex",
            middleTakesFull ? "md:flex-1 md:min-w-0" : "md:w-80 lg:w-96 md:shrink-0",
          )}
        >
          {renderMiddlePane()}
        </section>

        {/* Right pane (chat window or empty state) */}
        <section
          className={cn(
            "min-h-0 flex flex-col flex-1 min-w-0",
            // Hide right pane on mobile if no chat is open
            !showChatOnMobile && !rightPane ? "hidden" : "",
            // Show right pane on mobile only when chat is open
            showChatOnMobile ? "flex" : "hidden md:flex",
            // Hide right pane if section doesn't have one
            middleTakesFull && !rightPane ? "hidden" : "",
          )}
        >
          {rightPane ?? (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="text-center max-w-md">
                <div className="mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Shield className="h-6 w-6" />
                </div>
                <h2 className="text-base font-semibold text-text">
                  Select a conversation
                </h2>
                <p className="mt-1.5 text-sm text-text-muted">
                  Your DMs, rooms, and groups are encrypted on this device with
                  Curve25519 ECDH and XSalsa20-Poly1305. Pick one from the list, or
                  start a new encrypted chat.
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-text-faint">
                  <Badge variant="outline">
                    <Lock className="h-3 w-3" />
                    Ed25519 + Curve25519
                  </Badge>
                  <Badge variant="outline">
                    <Shield className="h-3 w-3" />
                    Circle protocol
                  </Badge>
                  <Badge variant="outline">
                    <Vote className="h-3 w-3" />
                    FHE polls
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      <NewChatModal open={newChatOpen} onOpenChange={setNewChatOpen} initialTab={newChatTab} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sidebar subcomponents                                                      */
/* -------------------------------------------------------------------------- */

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg shadow-sm">
        <Shield className="h-4 w-4" />
      </div>
      {!compact && (
        <span className="text-sm font-bold text-text tracking-tight">OctraChat</span>
      )}
    </div>
  );
}

function SidebarContent({
  section,
  onSelect,
  counts,
  onOpenNew,
  compact = false,
}: {
  section: Section;
  onSelect: (s: Section) => void;
  counts: { messages: number; rooms: number; groups: number };
  onOpenNew: (tab: "dm" | "room" | "group") => void;
  compact?: boolean;
}) {
  const identity = useChatStore((s) => s.identity);
  if (!identity) return null;

  const wallets = useChatStore.getState().wallets;
  const label = wallets.find((w) => w.address === identity.address)?.label ?? "Wallet";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3 flex flex-col gap-1">
      {/* Brand (only on desktop) */}
      {!compact && (
        <div className="hidden md:flex items-center gap-2 px-2 py-2 mb-2">
          <Brand />
        </div>
      )}

      {/* User card */}
      <div className="rounded-lg border border-border bg-surface-2/40 p-2 mb-2">
        <div className="flex items-center gap-2">
          <Avatar name={identity.address} size="sm" />
          <div className="min-w-0 flex-1 hidden md:block">
            <p className="text-xs font-semibold text-text truncate">{label}</p>
            <p className="text-[10px] text-text-faint font-mono truncate">
              {shortAddress(identity.address, 6, 4)}
            </p>
          </div>
        </div>
      </div>

      {/* Section nav */}
      <nav className="flex flex-col gap-0.5">
        {SECTION_ITEMS.map((item) => {
          const active = section === item.id;
          const badge = (() => {
            if (item.id === "messages") return counts.messages;
            if (item.id === "rooms") return counts.rooms;
            if (item.id === "groups") return counts.groups;
            return 0;
          })();
          return (
            <Tooltip key={item.id} content={compact ? item.label : item.hint} side="right">
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors w-full",
                  active
                    ? "bg-accent-soft text-accent font-medium"
                    : "text-text-muted hover:text-text hover:bg-surface-2/70",
                  compact && "justify-start",
                )}
              >
                <span className={cn("shrink-0", active && "text-accent")}>{item.icon}</span>
                <span className="hidden md:inline truncate flex-1 text-left">{item.label}</span>
                {badge > 0 && (
                  <span
                    className={cn(
                      "hidden md:inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold",
                      active ? "bg-accent text-accent-fg" : "bg-surface-2 text-text-muted",
                    )}
                  >
                    {badge}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
      </nav>

      {/* New chat shortcut (desktop only) */}
      <div className="hidden md:block mt-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onOpenNew("dm")}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          New chat
        </Button>
      </div>
    </div>
  );
}

function SidebarFooter({
  network,
  onNetworkChange,
  rpcHealthy,
  theme,
  onThemeChange,
  onLock,
  address,
  curvePub,
  label,
}: {
  network: OctraNetwork;
  onNetworkChange: (n: string) => void;
  rpcHealthy: boolean | null;
  theme: "light" | "dark" | "auto";
  onThemeChange: (t: "light" | "dark" | "auto") => void;
  onLock: () => void;
  address: string;
  curvePub: string;
  label: string;
}) {
  return (
    <div className="border-t border-border p-2 space-y-2 bg-surface">
      {/* User card with lock (desktop expanded) */}
      <div className="hidden md:flex items-center gap-2 rounded-md hover:bg-surface-2/70 p-1.5">
        <Avatar name={address} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-text truncate">{label}</p>
          <p className="text-[10px] text-text-faint font-mono truncate">
            {shortAddress(address, 6, 4)}
          </p>
        </div>
        <Tooltip content="Lock wallet" side="top">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-text-muted hover:text-danger"
            onClick={onLock}
            aria-label="Lock wallet"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </Tooltip>
      </div>

      {/* Network selector */}
      <div className="hidden md:flex items-center gap-2">
        <Select
          value={network}
          onValueChange={onNetworkChange}
          options={NETWORK_OPTIONS}
          aria-label="Network"
          className="flex-1"
        />
        <RpcDot healthy={rpcHealthy} />
      </div>

      {/* Theme toggle */}
      <div className="hidden md:flex items-center justify-between gap-1">
        <span className="text-[10px] text-text-muted uppercase tracking-wide">
          Theme
        </span>
        <div className="flex gap-0.5">
          <Button
            size="icon"
            variant={theme === "light" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={() => onThemeChange("light")}
            aria-label="Light theme"
          >
            <Sun className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant={theme === "dark" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={() => onThemeChange("dark")}
            aria-label="Dark theme"
          >
            <Moon className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant={theme === "auto" ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={() => onThemeChange("auto")}
            aria-label="Auto theme"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Mobile lock button */}
      <Button variant="danger" size="sm" className="md:hidden w-full" onClick={onLock}>
        <Lock className="h-3.5 w-3.5" />
        Lock wallet
      </Button>

      {/* Curve pub (small display) */}
      <div className="hidden md:block">
        <Tooltip content="Your Curve25519 public key — share so others can send E2E messages" side="top">
          <code className="block text-[9px] font-mono text-text-faint truncate">
            {curvePub}
          </code>
        </Tooltip>
      </div>
    </div>
  );
}

function RpcDot({ healthy }: { healthy?: boolean | null }) {
  const h = healthy ?? useChatStore((s) => s.rpcHealthy);
  const color = h === null ? "bg-text-faint" : h ? "bg-success" : "bg-danger";
  const label = h === null ? "RPC idle" : h ? "RPC reachable" : "RPC unreachable";
  return (
    <Tooltip content={label} side="top">
      <span
        className={cn("inline-block h-2 w-2 rounded-full animate-pulse-dot", color)}
        aria-label={label}
        role="status"
      />
    </Tooltip>
  );
}
