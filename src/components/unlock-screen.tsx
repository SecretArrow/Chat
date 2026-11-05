"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Wallet,
  AlertCircle,
  ChevronDown,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { ThemeToggle } from "@/components/theme-toggle";
import { useChatStore } from "@/stores/chat-store";
import type { WalletRecord } from "@/lib/octra/db";
import type { OctraNetwork } from "@/lib/octra/rpc";
import { OctraRpcClient, defaultRpcUrl } from "@/lib/octra/rpc";
import { cn, shortAddress } from "@/lib/utils";

/* ----------------------------------------------------------------------- *
 *  UnlockScreen
 *  Reusable component rendered by /unlock after hydration.
 *  Shows the wallet list, PIN input, network selector and RPC health dot.
 * ----------------------------------------------------------------------- */

export function UnlockScreen() {
  const router = useRouter();
  const wallets = useChatStore((s) => s.wallets);
  const unlock = useChatStore((s) => s.unlock);
  const network = useChatStore((s) => s.network);
  const setNetwork = useChatStore((s) => s.setNetwork);

  // Pre-select the default wallet (or the first one).
  const defaultWallet = React.useMemo(
    () => wallets.find((w) => w.isDefault) ?? wallets[0] ?? null,
    [wallets],
  );

  const [selectedAddr, setSelectedAddr] = React.useState<string | null>(
    defaultWallet?.address ?? null,
  );
  const [pin, setPin] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Keep selectedAddr valid as wallets list changes.
  React.useEffect(() => {
    if (!selectedAddr && defaultWallet) {
      setSelectedAddr(defaultWallet.address);
    }
    if (selectedAddr && !wallets.some((w) => w.address === selectedAddr)) {
      setSelectedAddr(defaultWallet?.address ?? null);
    }
  }, [selectedAddr, defaultWallet, wallets]);

  const selectedWallet = React.useMemo(
    () => wallets.find((w) => w.address === selectedAddr) ?? null,
    [wallets, selectedAddr],
  );

  const onUnlock = React.useCallback(async () => {
    if (!selectedWallet || !pin) return;
    setSubmitting(true);
    setError(null);
    try {
      await unlock(selectedWallet.address, pin);
      // store sets view to app; route entry handles redirect.
      router.replace("/app");
    } catch (err) {
      setSubmitting(false);
      setError(
        err instanceof Error
          ? err.message.includes("decrypt") || err.message.toLowerCase().includes("pin")
            ? "Wrong PIN. Try again."
            : err.message
          : "Failed to unlock",
      );
    }
  }, [selectedWallet, pin, unlock, router]);

  // Empty state — no wallets yet.
  if (wallets.length === 0) {
    return (
      <UnlockShell network={network} onNetworkChange={setNetwork}>
        <Card className="w-full max-w-md">
          <CardBody className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Wallet className="size-7" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">No wallets yet</h1>
              <p className="mt-1 text-sm text-text-muted">
                Create your first Octra wallet to start sending encrypted
                messages.
              </p>
            </div>
            <Link href="/setup" className="w-full">
              <Button className="w-full">
                <Plus className="size-4" />
                Create new wallet
              </Button>
            </Link>
            <Link
              href="/"
              className="text-xs text-text-faint transition-colors hover:text-text"
            >
              Back to home
            </Link>
          </CardBody>
        </Card>
      </UnlockShell>
    );
  }

  return (
    <UnlockShell network={network} onNetworkChange={setNetwork}>
      <Card className="w-full max-w-md">
        <CardBody className="flex flex-col gap-5 p-6 sm:p-7">
          {/* Brand */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Lock className="size-6" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Unlock wallet</h1>
              <p className="mt-0.5 text-sm text-text-muted">
                Pick a wallet and enter your PIN.
              </p>
            </div>
          </div>

          {/* Wallet picker */}
          <div className="flex flex-col gap-2">
            <label className="text-xs uppercase tracking-wider text-text-faint">
              Wallets ({wallets.length})
            </label>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              {wallets.map((w) => (
                <WalletRow
                  key={w.address}
                  wallet={w}
                  selected={w.address === selectedAddr}
                  onSelect={() => {
                    setSelectedAddr(w.address);
                    setError(null);
                    setPin("");
                  }}
                />
              ))}
            </div>
          </div>

          {/* PIN */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="unlock-pin">PIN</label>
            <div className="relative">
              <Input
                id="unlock-pin"
                type={show ? "text" : "password"}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && selectedWallet && pin && !submitting) {
                    void onUnlock();
                  }
                }}
                placeholder="Enter your PIN"
                autoComplete="current-password"
                disabled={submitting || !selectedWallet}
                className="pr-10"
                autoFocus={!!selectedWallet}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint hover:text-text"
                aria-label={show ? "Hide PIN" : "Show PIN"}
                tabIndex={-1}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={onUnlock}
            disabled={submitting || !selectedWallet || !pin}
            className="w-full"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Unlocking…
              </>
            ) : (
              <>
                <KeyRound className="size-4" />
                Unlock
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>

          <div className="flex items-center justify-between text-xs">
            <Link
              href="/setup"
              className="inline-flex items-center gap-1 text-text-muted transition-colors hover:text-text"
            >
              <Plus className="size-3.5" />
              Create new wallet
            </Link>
            <Link
              href="/"
              className="text-text-faint transition-colors hover:text-text"
            >
              Home
            </Link>
          </div>
        </CardBody>
      </Card>
    </UnlockShell>
  );
}

/* ---------------------------------------------------------- Wallet row */

function WalletRow({
  wallet,
  selected,
  onSelect,
}: {
  wallet: WalletRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-b-0",
        selected ? "bg-accent-soft/60" : "hover:bg-surface-2",
      )}
      aria-pressed={selected}
    >
      <Avatar name={wallet.label || wallet.address} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text">
            {wallet.label}
          </span>
          {wallet.isDefault && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              default
            </Badge>
          )}
        </div>
        <code className="block truncate font-mono text-xs text-text-faint">
          {shortAddress(wallet.address)}
        </code>
      </div>
      {selected && <Check className="size-4 shrink-0 text-accent" />}
    </button>
  );
}

/* ------------------------------------------------------------- Shell + motif */

function UnlockShell({
  children,
  network,
  onNetworkChange,
}: {
  children: React.ReactNode;
  network: OctraNetwork;
  onNetworkChange: (n: OctraNetwork) => void;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-bg text-text">
      {/* Circle motif background */}
      <CircleMotifBackground />

      {/* Top bar */}
      <header className="relative z-10 flex h-14 items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold"
        >
          <ShieldCheck className="size-4 text-accent" />
          OctraChat
        </Link>
        <ThemeToggle />
      </header>

      {/* Main card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <div className="animate-fade-in w-full max-w-md">{children}</div>
      </main>

      {/* Network selector + RPC health — bottom-right */}
      <div className="relative z-10 flex items-center justify-end gap-3 px-4 py-3 sm:px-6">
        <RpcHealthDot network={network} />
        <NetworkSelector network={network} onChange={onNetworkChange} />
      </div>
    </div>
  );
}

function CircleMotifBackground() {
  return (
    <>
      <div className="mesh-bg pointer-events-none absolute inset-0 opacity-60" />
      <svg
        viewBox="-160 -160 320 320"
        className="pointer-events-none absolute -right-32 top-1/2 h-[40rem] w-[40rem] -translate-y-1/2 opacity-[0.08] dark:opacity-[0.05]"
        aria-hidden="true"
        fill="none"
      >
        <circle cx="0" cy="0" r="150" stroke="rgb(var(--accent))" strokeWidth="0.8" />
        <circle cx="0" cy="0" r="110" stroke="rgb(var(--accent))" strokeWidth="0.8" />
        <circle cx="0" cy="0" r="70" stroke="rgb(var(--accent))" strokeWidth="0.8" />
        <circle cx="0" cy="0" r="30" stroke="rgb(var(--accent))" strokeWidth="0.8" />
        <circle cx="0" cy="0" r="6" fill="rgb(var(--accent))" />
        <circle cx="150" cy="0" r="3" fill="rgb(var(--success))" />
        <circle cx="0" cy="110" r="3" fill="rgb(var(--accent))" />
        <circle cx="-70" cy="0" r="2.5" fill="rgb(var(--warning))" />
      </svg>
    </>
  );
}

/* ------------------------------------------------------- Network selector */

const NETWORKS: { value: OctraNetwork; label: string }[] = [
  { value: "devnet", label: "Devnet" },
  { value: "mainnet", label: "Mainnet" },
  { value: "custom", label: "Custom" },
];

function NetworkSelector({
  network,
  onChange,
}: {
  network: OctraNetwork;
  onChange: (n: OctraNetwork) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = NETWORKS.find((n) => n.value === network) ?? NETWORKS[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Globe className="size-3.5" />
        <span className="font-mono">{current.label}</span>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full right-0 mb-2 w-36 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {NETWORKS.map((n) => (
            <button
              key={n.value}
              type="button"
              role="option"
              aria-selected={n.value === network}
              onClick={() => {
                void onChange(n.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors",
                n.value === network
                  ? "bg-accent-soft text-accent"
                  : "text-text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <span className="font-mono">{n.label}</span>
              {n.value === network && <Check className="size-3" />}
            </button>
          ))}
          <div className="border-t border-border px-3 py-1.5 text-[10px] text-text-faint">
            {defaultRpcUrl(network)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- RPC health dot */

function RpcHealthDot({ network }: { network: OctraNetwork }) {
  const rpcHealthy = useChatStore((s) => s.rpcHealthy);
  // We deliberately don't write back to the store here; the store has its
  // own ping logic. This is a local best-effort indicator.
  const [local, setLocal] = React.useState<boolean | null>(rpcHealthy);

  React.useEffect(() => {
    let cancelled = false;
    const client = new OctraRpcClient({ network });
    void client
      .ping()
      .then((ok) => {
        if (!cancelled) setLocal(ok);
      })
      .catch(() => {
        if (!cancelled) setLocal(false);
      });
    return () => {
      cancelled = true;
    };
  }, [network]);

  const state: { color: string; label: string; pulse: boolean } =
    local === null
      ? { color: "bg-text-faint", label: "Checking RPC…", pulse: true }
      : local
        ? { color: "bg-success", label: "RPC reachable", pulse: false }
        : { color: "bg-danger", label: "RPC unreachable", pulse: false };

  return (
    <div
      className="flex items-center gap-1.5 text-xs text-text-faint"
      title={state.label}
    >
      <span className="relative flex size-2">
        {state.pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              state.color,
            )}
          />
        )}
        <span className={cn("relative inline-flex size-2 rounded-full", state.color)} />
      </span>
      <span className="hidden font-mono sm:inline">{state.label}</span>
    </div>
  );
}
