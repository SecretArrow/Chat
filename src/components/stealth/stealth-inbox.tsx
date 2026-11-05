"use client";

/**
 * StealthInbox — scan + send Monero-style one-time address DMs.
 *
 * - "Scan for stealth messages": iterate all stealthOutputs in the store,
 *   tryOpenStealthOutput each with the user's curve key. Show scan/match
 *   counts and the messages that decrypted for us.
 * - "Send stealth DM": paste receiver curve pub + message, sealStealthMessage,
 *   push the output to the stealth pool via db.pushStealthOutput, then
 *   store.refreshStealth() so it appears in our own inbox (sender can also
 *   decrypt their own message since ECDH is symmetric).
 *
 * The stealth pool is global (per IndexedDB), so any wallet on this device
 * can scan it. In a real Octra deployment, this pool would be the chain.
 */
import { useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  Inbox,
  Lock,
  Radar,
  Send,
  Sparkles,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { pushStealthOutput } from "@/lib/octra/db";
import {
  sealStealthMessage,
  tryOpenStealthOutput,
  type StealthOutput,
  type SealedStealthMessage,
} from "@/lib/octra/stealth";
import { decodeCurvePub } from "@/lib/octra/crypto";
import { cn, formatTime, shortAddress, timeAgo } from "@/lib/utils";
import {
  Badge,
  CopyButton,
  EmptyState,
  Field,
  Modal,
  useToast,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/input";

interface OpenedMessage {
  output: StealthOutput;
  sealed: SealedStealthMessage;
  /** hex view tag for display */
  viewTagHex: string;
}

export function StealthInbox() {
  const identity = useChatStore((s) => s.identity);
  const stealthOutputs = useChatStore((s) => s.stealthOutputs);
  const refreshStealth = useChatStore((s) => s.refreshStealth);
  const { toast } = useToast();

  const [scanning, setScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [opened, setOpened] = useState<OpenedMessage[]>([]);
  const [lastScanAt, setLastScanAt] = useState<number | null>(null);

  // Send modal state
  const [showSend, setShowSend] = useState(false);
  const [toCp, setToCp] = useState("");
  const [msg, setMsg] = useState("");
  const [revealSender, setRevealSender] = useState(true);
  const [sending, setSending] = useState(false);

  const onScan = async () => {
    if (!identity) return;
    setScanning(true);
    try {
      const outs = stealthOutputs;
      let matched = 0;
      const results: OpenedMessage[] = [];
      for (const out of outs) {
        const sealed = await tryOpenStealthOutput(
          out,
          identity.curveSecretKey,
          identity.curvePublicKey,
        );
        if (sealed) {
          matched++;
          // Decode view tag to hex for display
          let hex = "";
          try {
            const tag = atob(out.tag);
            hex = Array.from(tag)
              .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
              .join("");
          } catch {
            hex = out.tag;
          }
          results.push({ output: out, sealed, viewTagHex: hex });
        }
      }
      results.sort((a, b) => b.sealed.ts - a.sealed.ts);
      setOpened(results);
      setScannedCount(outs.length);
      setLastScanAt(Date.now());
      toast({
        title: `Scan complete`,
        description: `Scanned ${outs.length} output${outs.length === 1 ? "" : "s"} · ${matched} matched your key`,
        variant: matched > 0 ? "success" : "default",
      });
    } catch (err) {
      toast({
        title: "Scan failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setScanning(false);
    }
  };

  const onSend = async () => {
    if (!identity) return;
    if (!toCp.trim().startsWith("cp_")) {
      toast({ title: "Receiver curve pub must start with cp_", variant: "danger" });
      return;
    }
    let recv: Uint8Array;
    try {
      recv = decodeCurvePub(toCp.trim());
    } catch {
      toast({ title: "Invalid curve pub encoding", variant: "danger" });
      return;
    }
    if (!msg.trim()) {
      toast({ title: "Message is empty", variant: "danger" });
      return;
    }
    setSending(true);
    try {
      const output = await sealStealthMessage(
        msg.trim(),
        recv,
        revealSender ? identity.address : undefined,
      );
      await pushStealthOutput(output);
      await refreshStealth();
      toast({
        title: "Stealth DM sealed",
        description: "Ephemeral Curve25519 key + view tag posted to stealth pool.",
        variant: "success",
      });
      setToCp("");
      setMsg("");
      setShowSend(false);
      // Auto-scan to surface our own message in the inbox
      setTimeout(() => onScan(), 200);
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setSending(false);
    }
  };

  const myCurvePub = identity ? `cp_${btoa(String.fromCharCode(...identity.curvePublicKey))}` : "";

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-text">
            <EyeOff className="h-4 w-4 text-accent" />
            Stealth Inbox
            {stealthOutputs.length > 0 && (
              <Badge variant="default" className="ml-1">
                {stealthOutputs.length} outputs
              </Badge>
            )}
          </h2>
          <Button size="sm" onClick={() => setShowSend(true)}>
            <Send className="h-4 w-4" />
            Send stealth DM
          </Button>
        </div>

        {/* Explanation banner */}
        <div className="rounded-md border border-accent/30 bg-accent-soft/40 p-3 text-xs text-text-muted flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-accent shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-text">Stealth addressing</p>
            <p className="mt-0.5">
              Receive DMs without revealing the sender. Only you can decrypt
              messages meant for you, using your Curve25519 private key. Like
              Monero one-time addresses — the sender generates an ephemeral key,
              computes a shared secret, and posts a ciphertext + 2-byte view tag
              to the public pool. You scan, filter by view tag, and decrypt only
              the ones that match.
            </p>
          </div>
        </div>
      </div>

      {/* Scan row */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <Button onClick={onScan} loading={scanning} disabled={!identity}>
          <Radar className="h-4 w-4" />
          Scan for stealth messages
        </Button>
        <div className="text-xs text-text-muted">
          {lastScanAt ? (
            <span>
              Last scan: <span className="text-text">{timeAgo(lastScanAt)}</span> ·{" "}
              <span className="text-text">{scannedCount}</span> scanned ·{" "}
              <span className="text-success">{opened.length}</span> matched
            </span>
          ) : (
            <span>Click scan to filter the stealth pool with your curve key.</span>
          )}
        </div>
      </div>

      {/* Your curve pub row */}
      {identity && (
        <div className="px-4 py-2 border-b border-border bg-surface-2/30 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-text-faint shrink-0" />
          <span className="text-[10px] text-text-muted shrink-0">Your scan key:</span>
          <code className="flex-1 text-[10px] font-mono text-text-faint truncate">
            {myCurvePub}
          </code>
          <CopyButton value={myCurvePub} />
        </div>
      )}

      {/* Inbox */}
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {opened.length === 0 ? (
          <EmptyState
            className="py-12"
            icon={<Inbox className="h-6 w-6" />}
            title="No matched messages"
            description={
              stealthOutputs.length === 0
                ? "The stealth pool is empty. Send a stealth DM to see how it works."
                : "Click 'Scan for stealth messages' above to filter the pool with your Curve25519 key."
            }
            action={
              stealthOutputs.length === 0 ? (
                <Button size="sm" onClick={() => setShowSend(true)}>
                  <Send className="h-4 w-4" />
                  Send first stealth DM
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {opened.map((m) => {
              const fromLabel = m.sealed.from
                ? shortAddress(m.sealed.from, 6, 4)
                : "anonymous";
              return (
                <li
                  key={m.output.ephPub + m.output.ts}
                  className="rounded-lg border border-border bg-surface p-3 animate-fade-in"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {m.sealed.from ? (
                        <Badge variant="accent">{fromLabel}</Badge>
                      ) : (
                        <Badge variant="outline">
                          <EyeOff className="h-3 w-3" />
                          anonymous
                        </Badge>
                      )}
                      <Badge variant="default" className="font-mono">
                        tag {m.viewTagHex}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-text-faint">
                      {formatTime(m.sealed.ts)} · {timeAgo(m.sealed.ts)}
                    </span>
                  </div>
                  <p className="text-sm text-text whitespace-pre-wrap break-words">
                    {m.sealed.text}
                  </p>
                  <div className="mt-2 pt-2 border-t border-border text-[10px] text-text-faint flex items-center gap-1">
                    <Lock className="h-3 w-3" />
                    Decrypted with ECDH(myCurveSec, ephPub) + XSalsa20-Poly1305
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Send Modal */}
      <Modal
        open={showSend}
        onOpenChange={setShowSend}
        title={
          <span className="inline-flex items-center gap-2">
            <Send className="h-4 w-4 text-accent" />
            Send stealth DM
          </span>
        }
        description="Sealed with an ephemeral Curve25519 key + view tag. Receiver decrypts only if their curve key matches."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowSend(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={onSend} loading={sending} disabled={!toCp.trim() || !msg.trim()}>
              Seal & send
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label="Receiver Curve25519 public key"
            required
            helperText="cp_<base64>. Get this from the receiver's Wallet tab."
          >
            <Input
              value={toCp}
              onChange={(e) => setToCp(e.target.value.trim())}
              placeholder="cp_…"
              className="font-mono"
              autoFocus
            />
          </Field>
          <Field label="Message" required>
            <Textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder="Top-secret message…"
              rows={4}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={revealSender}
              onChange={(e) => setRevealSender(e.target.checked)}
              className="rounded border-border-strong"
            />
            Reveal my Octra address as the sender
            <span className="text-xs text-text-faint">
              (otherwise fully anonymous)
            </span>
          </label>
          <div className="rounded-md border border-border bg-surface-2/50 p-3 text-xs text-text-muted">
            <Badge variant="outline" className="mb-1">Protocol</Badge>{" "}
            ECDH(ephSec, recvPub) → shared →{" "}
            <code className="font-mono">secretbox(msg, nonce, shared)</code>. View
            tag = first 2 bytes of SHA-256(recvPub ‖ ephPub). Receiver scans
            every output and only attempts decryption when tags match — massively
            cuts CPU vs. trying every output.
          </div>
        </div>
      </Modal>
    </div>
  );
}
