"use client";

import * as React from "react";
import Link from "next/link";
import {
  MessageSquare,
  Users,
  Globe,
  Lock,
  Eye,
  Vote,
  Shield,
  ShieldCheck,
  KeyRound,
  ArrowRight,
  RefreshCw,
  Copy,
  Check,
  Sparkles,
  Server,
  Cpu,
  Network,
  Boxes,
  Send,
  Sun,
  Moon,
  Footprints,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  generateMnemonic,
  buildIdentityFromMnemonic,
  isValidOctraAddress,
} from "@/lib/octra/crypto";
import { useChatStore } from "@/stores/chat-store";
import { shortAddress } from "@/lib/utils";

/* ----------------------------------------------------------------------- *
 *  Landing page
 *  Pure marketing — public-facing. Hydrates the store on mount but never
 *  blocks rendering of marketing content.
 * ----------------------------------------------------------------------- */

export default function LandingPage() {
  const hydrate = useChatStore((s) => s.hydrate);
  const wallets = useChatStore((s) => s.wallets);

  // Best-effort hydration so other routes see populated state.
  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="min-h-screen bg-bg text-text">
      <NavBar hasWallets={wallets.length > 0} />
      <Hero />
      <LiveAddressPreview />
      <FeaturesGrid />
      <CircleProtocolExplainer />
      <HowItWorks />
      <CryptoMarquee />
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ NavBar */

function NavBar({ hasWallets }: { hasWallets: boolean }) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark className="size-7" />
          <div className="flex items-baseline gap-1">
            <span className="text-base font-semibold tracking-tight">OctraChat</span>
            <span className="hidden text-xs text-text-faint sm:inline">/ circle</span>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="#features"
            className="rounded-md px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Features
          </Link>
          <Link
            href="#circle"
            className="rounded-md px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Circle
          </Link>
          <Link
            href="#how"
            className="rounded-md px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            How it works
          </Link>
          <Link
            href="#crypto"
            className="rounded-md px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            Crypto
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggleButton />
          {hasWallets ? (
            <Link href="/unlock">
              <Button size="sm" variant="outline">
                Open wallet
              </Button>
            </Link>
          ) : (
            <Link href="/setup">
              <Button size="sm">
                Get started
                <ArrowRight className="size-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function ThemeToggleButton() {
  const { theme, setTheme, mounted } = useTheme();
  const next = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";
  const label = `Theme: ${theme} (click for ${next})`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {mounted ? (
        theme === "light" ? (
          <Sun className="size-4" />
        ) : theme === "dark" ? (
          <Moon className="size-4" />
        ) : (
          <Sparkles className="size-4" />
        )
      ) : (
        <Sun className="size-4" />
      )}
    </Button>
  );
}

/* -------------------------------------------------------------------- Logo */

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <circle cx="16" cy="16" r="14" stroke="rgb(var(--accent))" strokeWidth="1.5" opacity="0.35" />
      <circle cx="16" cy="16" r="9" stroke="rgb(var(--accent))" strokeWidth="1.5" opacity="0.55" />
      <circle cx="16" cy="16" r="4" fill="rgb(var(--accent))" />
      <circle cx="30" cy="16" r="1.6" fill="rgb(var(--success))" />
      <circle cx="16" cy="2" r="1.4" fill="rgb(var(--accent))" opacity="0.7" />
    </svg>
  );
}

/* -------------------------------------------------------------------- Hero */

function Hero() {
  return (
    <section className="mesh-bg relative overflow-hidden border-b border-border/60">
      {/* faint grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18] dark:opacity-[0.10]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(var(--border)) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--border)) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:
            "radial-gradient(ellipse at center, black 0%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 0%, transparent 75%)",
        }}
      />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.05fr_0.95fr] md:py-24">
        <div className="animate-fade-in">
          <Badge
            variant="outline"
            className="mb-5 border-accent/30 bg-accent-soft/60 text-accent"
          >
            <Sparkles className="size-3" />
            Circle protocol · v0.1
          </Badge>

          <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            Encrypted messaging
            <br />
            <span className="bg-gradient-to-r from-accent to-[rgb(var(--success))] bg-clip-text text-transparent">
              on Octra
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-text-muted sm:text-lg">
            OctraChat is an end-to-end encrypted messenger built on Octra
            network primitives. Direct messages, chat rooms, and groups are
            sealed with Curve25519 ECDH and stored as opaque blobs in{" "}
            <span className="font-medium text-text">Circle</span> storage — a
            transport-agnostic, member-only container that lives on the Octra
            chain. No backend. No server. No metadata leak.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link href="/setup">
              <Button size="lg" className="w-full sm:w-auto">
                <KeyRound className="size-4" />
                Create Wallet
              </Button>
            </Link>
            <a href="#features">
              <Button
                size="lg"
                variant="outline"
                className="w-full sm:w-auto"
              >
                Learn More
                <ArrowRight className="size-4" />
              </Button>
            </a>
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-text-faint">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="size-3.5 text-success" />
              Ed25519 + Curve25519
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5 text-success" />
              XSalsa20-Poly1305
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="size-3.5 text-success" />
              PBKDF2 · 300k iters
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Server className="size-3.5 text-success" />
              Fully client-side
            </span>
          </div>
        </div>

        {/* Animated Circle SVG */}
        <div className="relative flex items-center justify-center">
          <CircleOrbitVisual className="w-full max-w-md" />
        </div>
      </div>
    </section>
  );
}

/**
 * Animated concentric-circle visual — pure SVG + CSS keyframes.
 * Three rings, three orbiting dots, one sender at the top, sealed envelope
 * at the bottom. Communicates the "Circle" primitive visually.
 */
function CircleOrbitVisual({ className }: { className?: string }) {
  return (
    <div className={className}>
      <style>{`
        @keyframes octra-orbit-cw { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes octra-orbit-ccw { from { transform: rotate(360deg); } to { transform: rotate(0deg); } }
        @keyframes octra-breathe { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
      `}</style>
      <svg viewBox="-120 -120 240 240" className="h-auto w-full" aria-hidden="true">
        <defs>
          <radialGradient id="octra-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--accent))" stopOpacity="0.45" />
            <stop offset="60%" stopColor="rgb(var(--accent))" stopOpacity="0.05" />
            <stop offset="100%" stopColor="rgb(var(--accent))" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* halo */}
        <circle cx="0" cy="0" r="115" fill="url(#octra-glow)" />

        {/* concentric rings (static) */}
        <circle cx="0" cy="0" r="100" stroke="rgb(var(--border-strong))" strokeWidth="0.8" fill="none" />
        <circle cx="0" cy="0" r="72" stroke="rgb(var(--border-strong))" strokeWidth="0.8" fill="none" />
        <circle cx="0" cy="0" r="44" stroke="rgb(var(--border-strong))" strokeWidth="0.8" fill="none" />

        {/* dashed member boundary */}
        <circle
          cx="0"
          cy="0"
          r="100"
          stroke="rgb(var(--accent))"
          strokeWidth="1"
          strokeDasharray="2 6"
          fill="none"
          opacity="0.4"
          style={{ animation: "octra-breathe 4s ease-in-out infinite" }}
        />

        {/* center seal */}
        <circle cx="0" cy="0" r="14" fill="rgb(var(--accent))" opacity="0.95" />
        <circle cx="0" cy="0" r="6" fill="rgb(var(--accent-fg))" />

        {/* orbiting dots — each <g> rotates around (0,0) */}
        <g style={{ transformOrigin: "0 0", animation: "octra-orbit-cw 7s linear infinite" }}>
          <circle cx="100" cy="0" r="4.5" fill="rgb(var(--success))" />
          <circle cx="100" cy="0" r="9" fill="rgb(var(--success))" opacity="0.18" />
        </g>
        <g style={{ transformOrigin: "0 0", animation: "octra-orbit-ccw 11s linear infinite" }}>
          <circle cx="72" cy="0" r="3.5" fill="rgb(var(--accent))" />
          <circle cx="72" cy="0" r="7" fill="rgb(var(--accent))" opacity="0.18" />
        </g>
        <g style={{ transformOrigin: "0 0", animation: "octra-orbit-cw 5s linear infinite" }}>
          <circle cx="44" cy="0" r="3" fill="rgb(var(--warning))" />
          <circle cx="44" cy="0" r="6" fill="rgb(var(--warning))" opacity="0.18" />
        </g>

        {/* sender node (top) */}
        <g>
          <circle cx="0" cy="-100" r="8" fill="rgb(var(--surface))" stroke="rgb(var(--accent))" strokeWidth="2" />
          <circle cx="0" cy="-100" r="3" fill="rgb(var(--accent))" />
        </g>

        {/* receiver node (bottom) */}
        <g>
          <circle cx="0" cy="100" r="8" fill="rgb(var(--surface))" stroke="rgb(var(--success))" strokeWidth="2" />
          <circle cx="0" cy="100" r="3" fill="rgb(var(--success))" />
        </g>

        {/* small ticks around the outer ring */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 30 * Math.PI) / 180;
          const x1 = Math.cos(angle) * 100;
          const y1 = Math.sin(angle) * 100;
          const x2 = Math.cos(angle) * 105;
          const y2 = Math.sin(angle) * 105;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgb(var(--border-strong))"
              strokeWidth="1"
            />
          );
        })}
      </svg>
    </div>
  );
}

/* ----------------------------------------------------- Live Address Preview */

function LiveAddressPreview() {
  const [addr, setAddr] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [copied, setCopied] = React.useState(false);

  const regenerate = React.useCallback(async () => {
    setLoading(true);
    setCopied(false);
    try {
      const mnemonic = generateMnemonic(256);
      const identity = await buildIdentityFromMnemonic(mnemonic);
      setAddr(identity.address);
    } catch {
      setAddr("");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void regenerate();
  }, [regenerate]);

  const valid = addr ? isValidOctraAddress(addr) : false;

  return (
    <section className="border-b border-border/60 bg-surface-2/40">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 md:py-16">
        <div className="grid items-center gap-6 md:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-faint">
              Live address preview
            </h2>
            <p className="mt-1 text-base text-text-muted">
              Every OctraChat wallet derives a 47-character{" "}
              <span className="font-mono text-text">oct…</span> address from
              its Ed25519 public key. Regenerate one in your browser right
              now — no network, no server.
            </p>
          </div>

          <Card className="glass w-full overflow-hidden md:w-[28rem]">
            <CardBody className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-text-faint">
                  Sample address
                </span>
                <Badge
                  variant="outline"
                  className={
                    valid
                      ? "border-success/30 text-success"
                      : "border-text-faint/30 text-text-faint"
                  }
                >
                  {valid ? "valid" : "—"}
                </Badge>
              </div>
              <code className="block break-all rounded-md bg-surface-2 px-3 py-3 font-mono text-sm text-text">
                {loading ? (
                  <span className="text-text-faint">deriving…</span>
                ) : (
                  addr
                )}
              </code>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={regenerate}
                  disabled={loading}
                  className="flex-1"
                >
                  <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
                  Regenerate
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!addr) return;
                    try {
                      await navigator.clipboard.writeText(addr);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1400);
                    } catch {
                      /* ignore */
                    }
                  }}
                  disabled={loading || !addr}
                  aria-label="Copy address"
                >
                  {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Features grid */

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Direct Messages",
    body: "1:1 conversations sealed with Curve25519 ECDH. A precomputed shared key wraps every message in XSalsa20-Poly1305 (crypto_box). No relay ever sees plaintext.",
    tag: "ECDH · Curve25519",
  },
  {
    icon: Globe,
    title: "Chat Rooms",
    body: "Public Circle storage with signed membership. Anyone with the room ID can read; members write. Perfect for open channels and announcements.",
    tag: "Public Circle",
  },
  {
    icon: Users,
    title: "Chat Groups",
    body: "Multi-recipient DMs using per-recipient envelopes. One encrypted body, N wrapped keys — efficient group messaging with sender-key rotation.",
    tag: "Per-recipient envelopes",
  },
  {
    icon: Shield,
    title: "Contacts",
    body: "Address book of curve public keys. Add by oct… address, verify the fingerprint, and your DMs use the stored key forever after.",
    tag: "cp_ keys",
  },
  {
    icon: Eye,
    title: "Stealth Addressing",
    body: "Anonymous DMs using ephemeral Curve25519 outputs. Send to a stealth address without revealing your identity or the recipient's.",
    tag: "Ephemeral outputs",
  },
  {
    icon: Vote,
    title: "FHE Polls",
    body: "Homomorphic tally with Paillier encryption. Votes are encrypted client-side; the sum is computed on ciphertexts — nobody sees individual choices.",
    tag: "Paillier FHE",
  },
] as const;

function FeaturesGrid() {
  return (
    <section id="features" className="border-b border-border/60 scroll-mt-14">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">
            <Boxes className="size-3" />
            Six primitives
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything an encrypted messenger needs
          </h2>
          <p className="mt-3 text-text-muted">
            OctraChat ships six conversation primitives. Each maps directly to
            a Circle storage pattern and a cryptographic construction.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card
              key={f.title}
              className="group relative overflow-hidden transition-all hover:border-accent/40 hover:shadow-lg"
            >
              <CardBody className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <f.icon className="size-5" />
                  </div>
                  <Badge variant="default" className="font-mono text-[10px]">
                    {f.tag}
                  </Badge>
                </div>
                <h3 className="text-base font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-text-muted">
                  {f.body}
                </p>
              </CardBody>
              <div
                className="pointer-events-none absolute -right-12 -top-12 size-32 rounded-full bg-accent/5 opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden="true"
              />
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------- Circle protocol explainer */

function CircleProtocolExplainer() {
  const layers = [
    {
      icon: Users,
      name: "members",
      desc: "Ed25519-signed membership list. Each member carries a role (admin / writer / reader).",
    },
    {
      icon: Network,
      name: "slots",
      desc: "Rotating slot ledger — every member writes to their own slot, preventing ordering races.",
    },
    {
      icon: Server,
      name: "storage",
      desc: "Opaque encrypted entries persisted to Octra chain. Unstructured blobs, indexed by ts.",
    },
    {
      icon: Send,
      name: "outbox",
      desc: "Per-member outbox of pending deliveries. Recipients pull on their own schedule.",
    },
    {
      icon: Footprints,
      name: "transport",
      desc: "Pluggable: on-chain storage today, p2p relays tomorrow. The Circle doesn't care.",
    },
  ];

  return (
    <section
      id="circle"
      className="border-b border-border/60 bg-surface-2/40 scroll-mt-14"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="grid gap-10 md:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Badge variant="outline" className="mb-4">
              <Network className="size-3" />
              Circle protocol
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              A Circle is a member-only
              <br />
              storage container.
            </h2>
            <p className="mt-4 text-text-muted">
              Every conversation in OctraChat is a Circle — a signed set of
              members with their own storage, slots, and outbox. The transport
              layer is pluggable. Encryption is per-message. The chain only
              sees opaque bytes.
            </p>
            <pre className="mt-6 overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-xs leading-relaxed text-text-muted">
{`Circle {
  members: Ed25519[]   // signed membership
  slots:   Slot[]      // per-member write slot
  storage: Entry[]     // opaque encrypted blobs
  outbox:  Outbox[]    // pending deliveries
  transport: "onchain" // pluggable
}`}
            </pre>
          </div>

          {/* Visual diagram */}
          <div className="flex flex-col gap-3">
            {layers.map((l, i) => (
              <div
                key={l.name}
                className="group relative flex items-start gap-4 rounded-xl border border-border bg-surface p-4 transition-all hover:border-accent/40"
                style={{ marginLeft: `${i * 12}px` }}
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <l.icon className="size-4.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-medium text-text">
                      {l.name}
                    </span>
                    <span className="font-mono text-[10px] text-text-faint">
                      layer {i + 1}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-text-muted">{l.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- How it works */

const STEPS = [
  {
    icon: KeyRound,
    title: "Generate wallet",
    body: "A 24-word BIP-39 mnemonic seeds an Ed25519 keypair via m/44'/1234'/0'/0'/0'. The Ed25519 secret is converted to a Curve25519 scalar for ECDH. Your oct… address is sha256(pubkey) base58-padded to 47 chars.",
    tag: "BIP-39 → Ed25519 → Curve25519",
  },
  {
    icon: Boxes,
    title: "Pick a conversation",
    body: "Direct message (1:1 ECDH), chat room (public Circle), or chat group (per-recipient envelopes). Each becomes its own Circle with signed membership and a deterministic ID.",
    tag: "DM / Room / Group",
  },
  {
    icon: Send,
    title: "Send E2E via Circle storage",
    body: "Encrypt with the precomputed shared key, wrap the box as a Circle storage entry, sign it with Ed25519, and submit to the chain. Recipients decrypt on their device. Nobody else can.",
    tag: "XSalsa20-Poly1305 · Ed25519 sig",
  },
] as const;

function HowItWorks() {
  return (
    <section id="how" className="border-b border-border/60 scroll-mt-14">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <Badge variant="outline" className="mb-4">
            <Footprints className="size-3" />
            Three steps
          </Badge>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            From mnemonic to message
          </h2>
          <p className="mt-3 text-text-muted">
            The full flow, in order. No accounts, no email, no phone number.
          </p>
        </div>

        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <Card className="h-full">
                <CardBody className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <s.icon className="size-5" />
                    </div>
                    <span className="font-mono text-3xl font-bold text-border-strong">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold">{s.title}</h3>
                  <p className="text-sm leading-relaxed text-text-muted">
                    {s.body}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-auto w-fit font-mono text-[10px]"
                  >
                    {s.tag}
                  </Badge>
                </CardBody>
              </Card>
              {i < STEPS.length - 1 && (
                <div
                  className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 md:block"
                  aria-hidden="true"
                >
                  <ArrowRight className="size-5 text-border-strong" />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------------------------------------- Crypto primitives marquee */

const CRYPTO_PRIMITIVES = [
  "Ed25519",
  "Curve25519",
  "XSalsa20-Poly1305",
  "AES-256-GCM",
  "PBKDF2 · 300k",
  "BIP-39",
  "Paillier FHE",
  "TweetNaCl",
  "sha256",
  "base58",
  "crypto_box",
  "crypto_secretbox",
];

function CryptoMarquee() {
  const list = [...CRYPTO_PRIMITIVES, ...CRYPTO_PRIMITIVES];
  return (
    <section
      id="crypto"
      className="overflow-hidden border-b border-border/60 bg-surface py-10 scroll-mt-14"
    >
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="mb-5 flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-wider text-text-faint">
          <Cpu className="size-3.5" />
          Cryptographic primitives
        </div>
      </div>

      <div
        className="relative w-full overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
        }}
      >
        <div
          className="flex w-max gap-2.5"
          style={{
            animation: "octra-marquee 38s linear infinite",
          }}
        >
          <style>{`
            @keyframes octra-marquee {
              from { transform: translateX(0); }
              to   { transform: translateX(-50%); }
            }
          `}</style>
          {list.map((p, i) => (
            <span
              key={i}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-text-muted"
            >
              <Lock className="size-3 text-accent" />
              {p}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ Footer */

function Footer() {
  return (
    <footer className="mt-auto bg-bg">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-6" />
            <span className="text-sm font-semibold">OctraChat</span>
            <span className="text-xs text-text-faint">/ circle</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <Network className="size-3.5 text-accent" />
              Built on Octra network
            </span>
            <span aria-hidden="true">•</span>
            <span className="inline-flex items-center gap-1.5">
              <Boxes className="size-3.5 text-accent" />
              Circle protocol
            </span>
            <span aria-hidden="true">•</span>
            <span className="inline-flex items-center gap-1.5">
              <Cpu className="size-3.5 text-accent" />
              Fully client-side
            </span>
            <span aria-hidden="true">•</span>
            <span className="inline-flex items-center gap-1.5">
              <Server className="size-3.5 text-accent" />
              No backend
            </span>
          </div>
        </div>

        <div className="mt-6 border-t border-border pt-6 text-center text-xs text-text-faint">
          <p>
            Your keys never leave this device. Wallets are encrypted at rest
            with AES-256-GCM + PBKDF2 (300k iters) and stored in IndexedDB.
          </p>
          <p className="mt-2 font-mono">
            oct… 47 chars · Ed25519 · Curve25519 · XSalsa20-Poly1305
          </p>
        </div>
      </div>
    </footer>
  );
}
