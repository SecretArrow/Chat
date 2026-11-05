"use client";

/**
 * WalletView — active wallet info + RPC lookups + export mnemonic + switch.
 *
 * Sections:
 *   - Active wallet card: avatar, label, full address (copy), created date,
 *     Curve25519 public key (copy) — needed for others to send E2E messages.
 *   - Network selector: devnet / mainnet / custom URL.
 *   - Best-effort RPC lookup (balance ping, labelled "may timeout if RPC is down").
 *   - Lock wallet button → store.lock().
 *   - Export mnemonic → PIN re-entry modal → reveal + copy + warning.
 *   - Switch wallet → list other wallets → click → unlock prompt.
 *   - Settings: theme toggle (light/dark/auto) via useTheme.
 *   - Crypto info card: list primitives in use.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Monitor,
  Moon,
  Network,
  RefreshCw,
  Shield,
  Sun,
  ArrowLeftRight,
  Wallet,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { useTheme } from "@/components/theme-provider";
import type { OctraNetwork, OctraAccount } from "@/lib/octra/rpc";
import { OctraRpcClient, defaultRpcUrl } from "@/lib/octra/rpc";
import { unlockWallet } from "@/lib/octra/wallet";
import { encodeCurvePub, validatePin } from "@/lib/octra/crypto";
import { cn, formatDate, shortAddress } from "@/lib/utils";
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CopyButton,
  Field,
  Modal,
  Select,
  useToast,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput } from "@/components/ui/input";

const NETWORK_OPTIONS = [
  { value: "devnet", label: "Devnet" },
  { value: "mainnet", label: "Mainnet" },
  { value: "custom", label: "Custom" },
];

export function WalletView() {
  const identity = useChatStore((s) => s.identity);
  const wallets = useChatStore((s) => s.wallets);
  const network = useChatStore((s) => s.network);
  const setNetwork = useChatStore((s) => s.setNetwork);
  const rpcHealthy = useChatStore((s) => s.rpcHealthy);
  const lock = useChatStore((s) => s.lock);
  const switchWallet = useChatStore((s) => s.switchWallet);
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  const [rpcLoading, setRpcLoading] = useState(false);
  const [rpcAccount, setRpcAccount] = useState<OctraAccount | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState("");
  const [showExport, setShowExport] = useState(false);
  const [showSwitch, setShowSwitch] = useState(false);

  // Refresh RPC health on network change
  useEffect(() => {
    setRpcAccount(null);
    setRpcError(null);
  }, [network]);

  const onRpcLookup = useCallback(async () => {
    if (!identity) return;
    setRpcLoading(true);
    setRpcError(null);
    setRpcAccount(null);
    try {
      const client = new OctraRpcClient({
        network: network as OctraNetwork,
        url: network === "custom" ? customUrl || undefined : undefined,
      });
      const res = await client.getAccount(identity.address);
      if (!res.ok || !res.result) {
        setRpcError(res.error ?? "RPC unreachable");
      } else {
        setRpcAccount(res.result);
        toast({
          title: "Account fetched",
          description: `Balance: ${res.result.balance ?? "n/a"}`,
          variant: "success",
        });
      }
    } catch (err) {
      setRpcError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setRpcLoading(false);
    }
  }, [identity, network, customUrl, toast]);

  const myCurvePub = useMemo(
    () => (identity ? encodeCurvePub(identity.curvePublicKey) : ""),
    [identity],
  );

  if (!identity) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        Wallet locked.
      </div>
    );
  }

  const activeWallet = wallets.find((w) => w.address === identity.address);

  const themeOptions: { value: "light" | "dark" | "auto"; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun className="h-3.5 w-3.5" /> },
    { value: "dark", label: "Dark", icon: <Moon className="h-3.5 w-3.5" /> },
    { value: "auto", label: "Auto", icon: <Monitor className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-bg">
      {/* Header */}
      <div className="px-4 sm:px-6 pt-4 pb-3 border-b border-border">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-text">
          <Wallet className="h-4 w-4 text-accent" />
          Wallet & Settings
        </h2>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-4 max-w-3xl w-full mx-auto">
        {/* Active wallet card */}
        <Card>
          <CardHeader
            icon={<Wallet className="h-5 w-5" />}
            title="Active wallet"
            description={activeWallet?.label ?? "Unlocked wallet"}
            action={
              <Badge variant={rpcHealthy === null ? "outline" : rpcHealthy ? "success" : "danger"}>
                {rpcHealthy === null ? "RPC idle" : rpcHealthy ? "RPC up" : "RPC down"}
              </Badge>
            }
          />
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar name={identity.address} size="xl" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-text">
                  {activeWallet?.label ?? "Default wallet"}
                </p>
                <p className="text-xs text-text-muted">
                  Created {activeWallet ? formatDate(activeWallet.createdAt) : "—"}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-faint mb-1">
                Octra address
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface-2 rounded px-2 py-1.5 text-xs font-mono break-all text-text">
                  {identity.address}
                </code>
                <CopyButton value={identity.address} label="Copy" />
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-faint mb-1 flex items-center gap-1">
                <KeyRound className="h-3 w-3" />
                Curve25519 public key (share to receive E2E messages)
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface-2 rounded px-2 py-1.5 text-xs font-mono break-all text-text">
                  {myCurvePub}
                </code>
                <CopyButton value={myCurvePub} label="Copy" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowExport(true)}>
                <Eye className="h-4 w-4" />
                Export mnemonic
              </Button>
              <Button variant="danger" onClick={lock}>
                <Lock className="h-4 w-4" />
                Lock wallet
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Network card */}
        <Card>
          <CardHeader
            icon={<Network className="h-5 w-5" />}
            title="Octra network"
            description="Best-effort RPC lookups (balance / account info). May timeout if RPC is down — chat keeps working."
          />
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={network}
                onValueChange={(v) => setNetwork(v as OctraNetwork)}
                options={NETWORK_OPTIONS}
                aria-label="Network"
              />
              <code className="text-[10px] text-text-faint font-mono">
                {network === "custom" ? (customUrl || defaultRpcUrl("custom")) : defaultRpcUrl(network as OctraNetwork)}
              </code>
            </div>
            {network === "custom" && (
              <Field label="Custom RPC URL" helperText="http(s)://host:port/rpc">
                <Input
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://localhost:8080/rpc"
                  className="font-mono text-xs"
                />
              </Field>
            )}
            <Button onClick={onRpcLookup} loading={rpcLoading}>
              <RefreshCw className="h-4 w-4" />
              Best-effort RPC lookup
            </Button>
            {rpcError && (
              <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-xs text-danger flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">RPC lookup failed</p>
                  <p className="mt-0.5 break-words">{rpcError}</p>
                </div>
              </div>
            )}
            {rpcAccount && (
              <div className="rounded-md border border-success/30 bg-success/10 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Balance</span>
                  <span className="font-semibold text-text">
                    {rpcAccount.balance ?? "n/a"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Nonce</span>
                  <span className="font-semibold text-text">
                    {rpcAccount.nonce ?? "n/a"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Pub key</span>
                  <span className="font-mono text-text truncate max-w-[60%]">
                    {rpcAccount.pub_key ?? "n/a"}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Switch wallet */}
        <Card>
          <CardHeader
            icon={<ArrowLeftRight className="h-5 w-5" />}
            title="Other wallets on this device"
            description="Switch the active identity. Re-locks the current one."
            action={
              <Button size="sm" variant="ghost" onClick={() => setShowSwitch(true)}>
                Switch
                <ChevronRight className="h-4 w-4" />
              </Button>
            }
          />
          <CardContent>
            <ul className="divide-y divide-border">
              {wallets.map((w) => (
                <li key={w.id} className="py-2 flex items-center gap-3">
                  <Avatar name={w.address} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">
                      {w.label}
                      {w.isDefault && <Badge variant="accent" className="ml-2">default</Badge>}
                    </p>
                    <p className="text-[10px] text-text-faint font-mono truncate">
                      {shortAddress(w.address, 8, 6)}
                    </p>
                  </div>
                  {w.address === identity.address ? (
                    <Badge variant="success">active</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowSwitch(true)}
                    >
                      Switch
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Settings: theme */}
        <Card>
          <CardHeader
            icon={<Monitor className="h-5 w-5" />}
            title="Appearance"
            description="Theme follows your system by default."
          />
          <CardContent>
            <div className="flex gap-1 rounded-lg bg-surface-2 p-1 border border-border">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setTheme(opt.value)}
                  className={cn(
                    "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors",
                    theme === opt.value
                      ? "bg-surface text-text shadow-sm"
                      : "text-text-muted hover:text-text",
                  )}
                >
                  {opt.icon}
                  {opt.label}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Crypto info */}
        <Card>
          <CardHeader
            icon={<Shield className="h-5 w-5" />}
            title="Cryptographic primitives in use"
            description="Everything is computed client-side. No private material leaves the browser."
          />
          <CardContent>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {[
                { name: "Ed25519", use: "Signing keypairs + Octra address derivation" },
                { name: "Curve25519 ECDH", use: "Shared secret for DM and group envelopes" },
                { name: "XSalsa20-Poly1305", use: "Message encryption (crypto_box / secretbox)" },
                { name: "AES-256-GCM", use: "Wallet at-rest PIN encryption (Web Crypto)" },
                { name: "PBKDF2-HMAC-SHA256", use: "PIN → AES key (300,000 iterations)" },
                { name: "BIP-39 mnemonic", use: "24-word seed → Octra HD v2 (HMAC-SHA512 \"Octra seed\")" },
                { name: "Paillier FHE", use: "Additive homomorphic tally for polls (512-bit)" },
                { name: "Stealth addressing", use: "Ephemeral Curve25519 + view tags (Monero-style)" },
              ].map((p) => (
                <li
                  key={p.name}
                  className="rounded-md border border-border bg-surface-2/40 p-2.5"
                >
                  <p className="font-semibold text-text">{p.name}</p>
                  <p className="mt-0.5 text-text-muted">{p.use}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="text-[10px] text-text-faint text-center pb-2">
          OctraChat · Circle protocol client · Built on Octra network primitives
        </div>
      </div>

      {/* Export mnemonic modal */}
      <ExportMnemonicModal
        open={showExport}
        onOpenChange={setShowExport}
        address={identity.address}
      />

      {/* Switch wallet modal */}
      <SwitchWalletModal
        open={showSwitch}
        onOpenChange={setShowSwitch}
        currentAddress={identity.address}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Export mnemonic modal                                                      */
/* -------------------------------------------------------------------------- */

function ExportMnemonicModal({
  open,
  onOpenChange,
  address,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  address: string;
}) {
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPin("");
      setMnemonic(null);
      setRevealed(false);
      setError(null);
    }
  }, [open]);

  const onUnlock = async () => {
    const pinCheck = validatePin(pin);
    if (!pinCheck.ok) {
      setError(pinCheck.reason ?? "Invalid PIN");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const id = await unlockWallet(address, pin);
      setMnemonic(id.mnemonic || "(no mnemonic — imported from seed)");
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="inline-flex items-center gap-2">
          <Eye className="h-4 w-4 text-accent" />
          Export mnemonic
        </span>
      }
      description="Re-enter your PIN to reveal the 24-word seed phrase."
      size="md"
    >
      <div className="space-y-3">
        {/* Warning */}
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Anyone with these words controls your wallet.</p>
            <p className="mt-0.5 text-warning/80">
              Don&rsquo;t share, screenshot, or paste into untrusted sites. OctraChat
              never transmits the mnemonic — this stays on your device.
            </p>
          </div>
        </div>

        {!revealed && (
          <Field label="PIN" required error={error}>
            <PasswordInput
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Your wallet PIN"
              autoFocus
            />
          </Field>
        )}

        {!revealed && (
          <Button onClick={onUnlock} loading={loading} disabled={!pin} className="w-full">
            Reveal mnemonic
          </Button>
        )}

        {revealed && mnemonic && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-surface-2/40 p-3">
              <p className="text-[10px] uppercase tracking-wide text-text-faint mb-2">
                24-word mnemonic
              </p>
              <p className="text-sm font-mono leading-relaxed break-words text-text select-all">
                {mnemonic}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <CopyButton value={mnemonic} label="Copy mnemonic" variant="outline" size="md" />
              <Button
                variant="ghost"
                size="md"
                onClick={() => setRevealed(false)}
                className="ml-auto"
              >
                <EyeOff className="h-4 w-4" />
                Hide
              </Button>
            </div>
            <Button
              variant="danger"
              onClick={() => {
                onOpenChange(false);
                toast({ title: "Mnemonic hidden", variant: "default" });
              }}
              className="w-full"
            >
              <Lock className="h-4 w-4" />
              Done — re-lock
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  Switch wallet modal                                                        */
/* -------------------------------------------------------------------------- */

function SwitchWalletModal({
  open,
  onOpenChange,
  currentAddress,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentAddress: string;
}) {
  const wallets = useChatStore((s) => s.wallets);
  const switchWallet = useChatStore((s) => s.switchWallet);
  const { toast } = useToast();
  const [selectedAddr, setSelectedAddr] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelectedAddr(null);
      setPin("");
      setError(null);
    }
  }, [open]);

  const onSwitch = async () => {
    if (!selectedAddr) return;
    const pinCheck = validatePin(pin);
    if (!pinCheck.ok) {
      setError(pinCheck.reason ?? "Invalid PIN");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await switchWallet(selectedAddr, pin);
      toast({
        title: "Wallet switched",
        description: shortAddress(selectedAddr, 8, 6),
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wrong PIN");
    } finally {
      setLoading(false);
    }
  };

  const others = wallets.filter((w) => w.address !== currentAddress);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="inline-flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-accent" />
          Switch wallet
        </span>
      }
      description="Pick a wallet and re-enter its PIN."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onSwitch} loading={loading} disabled={!selectedAddr || !pin}>
            Switch wallet
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {others.length === 0 ? (
          <p className="text-sm text-text-muted">
            No other wallets on this device. Create or import one first.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {others.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setSelectedAddr(w.address)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 text-left transition-colors",
                    selectedAddr === w.address ? "bg-accent-soft" : "hover:bg-surface-2/70",
                  )}
                >
                  <Avatar name={w.address} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">{w.label}</p>
                    <p className="text-[10px] text-text-faint font-mono truncate">
                      {shortAddress(w.address, 8, 6)}
                    </p>
                  </div>
                  {selectedAddr === w.address && <Badge variant="accent">selected</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedAddr && (
          <Field label="PIN" required error={error}>
            <PasswordInput
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Wallet PIN"
              autoFocus
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
