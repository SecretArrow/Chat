"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  Eye,
  EyeOff,
  Download,
  Plus,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  generateMnemonic,
  validateMnemonic,
  validatePin,
} from "@/lib/octra/crypto";
import { useChatStore } from "@/stores/chat-store";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------------- *
 *  Setup page — create or import wallet
 * ----------------------------------------------------------------------- */

export default function SetupPage() {
  const router = useRouter();
  const hydrated = useChatStore((s) => s.hydrated);
  const hydrate = useChatStore((s) => s.hydrate);
  const wallets = useChatStore((s) => s.wallets);

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // If wallets exist and we're not in the middle of creating one,
  // the user should go through unlock instead.
  React.useEffect(() => {
    if (hydrated && wallets.length > 0) {
      router.replace("/unlock");
    }
  }, [hydrated, wallets.length, router]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <SetupHeader />
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6">
        <Tabs defaultValue="create" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="create" className="flex-1">
              <Plus className="size-4" />
              Create new wallet
            </TabsTrigger>
            <TabsTrigger value="import" className="flex-1">
              <Download className="size-4" />
              Import existing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="mt-6">
            <CreateFlow />
          </TabsContent>
          <TabsContent value="import" className="mt-6">
            <ImportFlow />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/* ----------------------------------------------------------------- Header */

function SetupHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <Wallet className="size-4 text-accent" />
          <span className="text-sm font-semibold">Wallet setup</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

/* --------------------------------------------------------------- Create flow */

const CREATE_STEPS = ["Mnemonic", "Verify", "PIN", "Label"] as const;
type CreateStepIdx = 0 | 1 | 2 | 3;

function CreateFlow() {
  const [step, setStep] = React.useState<CreateStepIdx>(0);
  const [mnemonic, setMnemonic] = React.useState<string>("");
  const [pin, setPin] = React.useState<string>("");
  const [label, setLabel] = React.useState<string>("My Octra wallet");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const createWallet = useChatStore((s) => s.createWallet);

  // Auto-generate a mnemonic on mount.
  React.useEffect(() => {
    if (!mnemonic) {
      setMnemonic(generateMnemonic(256));
    }
  }, [mnemonic]);

  const regenerate = React.useCallback(() => {
    setMnemonic(generateMnemonic(256));
    setStep(0);
  }, []);

  const onSubmit = React.useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await createWallet(label.trim() || "Octra wallet", pin);
      // store transitions to app view automatically.
      // The app shell route will pick up identity and render.
    } catch (err) {
      setSubmitting(false);
      setSubmitError(
        err instanceof Error ? err.message : "Failed to create wallet",
      );
    }
  }, [createWallet, label, pin]);

  return (
    <div className="flex flex-col gap-6">
      <StepIndicator current={step} />

      {step === 0 && (
        <MnemonicStep
          mnemonic={mnemonic}
          onRegenerate={regenerate}
          onNext={() => setStep(1)}
        />
      )}

      {step === 1 && (
        <VerifyStep
          mnemonic={mnemonic}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <PinStep
          pin={pin}
          onPinChange={setPin}
          onBack={() => setStep(1)}
          onNext={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <LabelStep
          label={label}
          onLabelChange={setLabel}
          pin={pin}
          submitting={submitting}
          submitError={submitError}
          onBack={() => setStep(2)}
          onSubmit={onSubmit}
        />
      )}
    </div>
  );
}

function StepIndicator({ current }: { current: CreateStepIdx }) {
  return (
    <ol className="flex items-center gap-2">
      {CREATE_STEPS.map((label, i) => {
        const idx = i as CreateStepIdx;
        const isDone = idx < current;
        const isCurrent = idx === current;
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all",
                isDone && "border-success bg-success/10 text-success",
                isCurrent && "border-accent bg-accent text-accent-fg",
                !isDone && !isCurrent && "border-border text-text-faint",
              )}
            >
              {isDone ? <Check className="size-4" /> : idx + 1}
            </div>
            <span
              className={cn(
                "hidden text-xs font-medium sm:inline",
                isCurrent ? "text-text" : "text-text-faint",
              )}
            >
              {label}
            </span>
            {idx < CREATE_STEPS.length - 1 && (
              <div className="h-px flex-1 bg-border" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------ Mnemonic step (0) */

function MnemonicStep({
  mnemonic,
  onRegenerate,
  onNext,
}: {
  mnemonic: string;
  onRegenerate: () => void;
  onNext: () => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const words = mnemonic.trim().split(/\s+/);

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }, [mnemonic]);

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Your recovery phrase</h2>
          <p className="text-sm text-text-muted">
            These 24 words are the only way to recover your wallet and all
            your messages. We can&apos;t help you if you lose them.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Save these words.</p>
            <p className="text-xs opacity-80">
              If you lose them, your wallet and all your messages are
              unrecoverable. Do not share them with anyone.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {words.map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-2"
            >
              <span className="font-mono text-[10px] font-semibold text-text-faint">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="font-mono text-sm text-text">{w}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? (
              <Check className="size-4 text-success" />
            ) : (
              <Copy className="size-4" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onRegenerate}>
            <RefreshCw className="size-4" />
            Regenerate
          </Button>
          <div className="ml-auto">
            <Button size="sm" onClick={onNext}>
              I saved it
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------- Verify step (1) */

const VERIFY_INDICES = [6, 13, 20]; // 0-based -> words #7, #14, #21

function VerifyStep({
  mnemonic,
  onBack,
  onNext,
}: {
  mnemonic: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const words = mnemonic.trim().split(/\s+/);
  const [answers, setAnswers] = React.useState<string[]>(
    () => VERIFY_INDICES.map(() => ""),
  );
  const [touched, setTouched] = React.useState(false);

  const correct = answers.map((a, i) =>
    a.trim().toLowerCase() === (words[VERIFY_INDICES[i]] ?? "").toLowerCase(),
  );
  const allCorrect = correct.every(Boolean);

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Verify your phrase</h2>
          <p className="text-sm text-text-muted">
            Type the requested words to confirm you saved them. This prevents
            skipping ahead without backing up.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {VERIFY_INDICES.map((idx, i) => (
            <div key={idx} className="flex flex-col gap-1.5">
              <label htmlFor={`verify-${idx}`}>Word #{idx + 1}</label>
              <div className="relative">
                <Input
                  id={`verify-${idx}`}
                  value={answers[i]}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => {
                    const next = [...answers];
                    next[i] = e.target.value;
                    setAnswers(next);
                  }}
                  onBlur={() => setTouched(true)}
                  className={cn(
                    answers[i] && touched && !correct[i] && "border-danger",
                    answers[i] && correct[i] && "border-success",
                  )}
                />
                {answers[i] && correct[i] && (
                  <Check className="absolute right-2 top-1/2 size-4 -translate-y-1/2 text-success" />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div className="ml-auto">
            <Button size="sm" onClick={onNext} disabled={!allCorrect}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* ---------------------------------------------------------- PIN step (2) */

function PinStep({
  pin,
  onPinChange,
  onBack,
  onNext,
}: {
  pin: string;
  onPinChange: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);

  const check = validatePin(pin);
  const match = pin.length > 0 && pin === confirm;
  const canContinue = check.ok && match;

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Set your PIN</h2>
          <p className="text-sm text-text-muted">
            The PIN encrypts your wallet at rest with AES-256-GCM, derived via
            PBKDF2 (300k iterations). It is the only thing standing between an
            attacker with your browser and your messages.
          </p>
        </div>

        <PinFields
          pin={pin}
          onPinChange={onPinChange}
          confirm={confirm}
          onConfirmChange={setConfirm}
          show={show}
          onToggleShow={() => setShow((s) => !s)}
        />

        <PinStrength pin={pin} />

        {!check.ok && pin.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{check.reason}</span>
          </div>
        )}
        {pin.length > 0 && confirm.length > 0 && !match && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>PINs do not match.</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div className="ml-auto">
            <Button size="sm" onClick={onNext} disabled={!canContinue}>
              Continue
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function PinFields({
  pin,
  onPinChange,
  confirm,
  onConfirmChange,
  show,
  onToggleShow,
}: {
  pin: string;
  onPinChange: (v: string) => void;
  confirm: string;
  onConfirmChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pin">PIN</label>
        <div className="relative">
          <Input
            id="pin"
            type={show ? "text" : "password"}
            value={pin}
            autoComplete="new-password"
            onChange={(e) => onPinChange(e.target.value)}
            className="pr-10"
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-faint hover:text-text"
            aria-label={show ? "Hide PIN" : "Show PIN"}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="pin-confirm">Confirm PIN</label>
        <Input
          id="pin-confirm"
          type={show ? "text" : "password"}
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => onConfirmChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function PinStrength({ pin }: { pin: string }) {
  if (!pin) return null;
  const { ok } = validatePin(pin);

  // Strength heuristic — independent of validity.
  let score = 0;
  if (pin.length >= 8) score += 1;
  if (pin.length >= 12) score += 1;
  if (pin.length >= 16) score += 1;
  if (pin.length >= 24) score += 1;
  if (/[a-z]/.test(pin) && /[A-Z]/.test(pin)) score += 1;
  if (/[0-9]/.test(pin)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pin)) score += 1;

  const level = !ok
    ? "weak"
    : score >= 6
      ? "very-strong"
      : score >= 4
        ? "strong"
        : score >= 2
          ? "good"
          : "ok";

  const config: Record<string, { label: string; color: string; pct: number }> = {
    weak: { label: "Weak", color: "bg-danger", pct: 25 },
    ok: { label: "OK", color: "bg-warning", pct: 40 },
    good: { label: "Good", color: "bg-warning", pct: 60 },
    strong: { label: "Strong", color: "bg-success", pct: 80 },
    "very-strong": { label: "Very strong", color: "bg-success", pct: 100 },
  };

  const c = config[level];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">PIN strength</span>
        <span
          className={cn(
            "font-medium",
            level === "weak" && "text-danger",
            level === "ok" && "text-warning",
            level === "good" && "text-warning",
            (level === "strong" || level === "very-strong") && "text-success",
          )}
        >
          {c.label}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full transition-all duration-300", c.color)}
          style={{ width: `${c.pct}%` }}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Label step (3) */

function LabelStep({
  label,
  onLabelChange,
  pin: _pin,
  submitting,
  submitError,
  onBack,
  onSubmit,
}: {
  label: string;
  onLabelChange: (v: string) => void;
  pin: string;
  submitting: boolean;
  submitError: string | null;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Name your wallet</h2>
          <p className="text-sm text-text-muted">
            A friendly label so you can tell multiple wallets apart. This is
            stored locally and never leaves your device.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="label">Wallet label</label>
          <Input
            id="label"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="My Octra wallet"
            maxLength={48}
          />
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="text-text-muted">
            <p className="font-medium text-text">Ready to create</p>
            <p className="text-xs">
              We&apos;ll derive your Ed25519 + Curve25519 keys, compute your{" "}
              <span className="font-mono">oct…</span> address, and encrypt
              everything with your PIN.
            </p>
          </div>
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={submitting}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div className="ml-auto">
            <Button onClick={onSubmit} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deriving keys…
                </>
              ) : (
                <>
                  <KeyRound className="size-4" />
                  Create wallet
                </>
              )}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-text-faint">
          PBKDF2 (300k iters) + AES-256-GCM · ~300ms
        </p>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------- Import flow */

function ImportFlow() {
  const [mode, setMode] = React.useState<"mnemonic" | "privkey">("mnemonic");
  const [mnemonic, setMnemonic] = React.useState("");
  const [privKey, setPrivKey] = React.useState("");
  const [pin, setPin] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [label, setLabel] = React.useState("Imported wallet");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const importWallet = useChatStore((s) => s.importWallet);
  const importWalletFromPrivKey = useChatStore((s) => s.importWalletFromPrivKey);

  const trimmedMnemonic = mnemonic.trim();
  const mnemonicValid = trimmedMnemonic.length > 0 && validateMnemonic(trimmedMnemonic);
  const trimmedPrivKey = privKey.trim();
  // Base64 of 32 bytes = 44 chars with padding, or 88 chars for 64 bytes
  const privKeyValid = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmedPrivKey) &&
    (trimmedPrivKey.length === 44 || trimmedPrivKey.length === 88);
  const pinCheck = validatePin(pin);
  const pinsMatch = pin.length > 0 && pin === confirm;
  const inputValid = mode === "mnemonic" ? mnemonicValid : privKeyValid;
  const canSubmit = inputValid && pinCheck.ok && pinsMatch && !submitting;

  const onSubmit = React.useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === "mnemonic") {
        await importWallet(trimmedMnemonic, label.trim() || "Imported wallet", pin);
      } else {
        await importWalletFromPrivKey(trimmedPrivKey, label.trim() || "Imported wallet", pin);
      }
      // store transitions to app view automatically
    } catch (err) {
      setSubmitting(false);
      setSubmitError(
        err instanceof Error ? err.message : "Failed to import wallet",
      );
    }
  }, [canSubmit, mode, trimmedMnemonic, trimmedPrivKey, label, pin, importWallet, importWalletFromPrivKey]);

  return (
    <Card>
      <CardBody className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Import wallet</h2>
          <p className="text-sm text-text-muted">
            Restore from a recovery phrase or a raw private key. We&apos;ll re-derive
            your Ed25519 + Curve25519 keys and re-encrypt them with a fresh PIN.
          </p>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2 p-1 bg-surface-2 rounded-lg">
          <button
            type="button"
            onClick={() => setMode("mnemonic")}
            className={cn(
              "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              mode === "mnemonic" ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text"
            )}
          >
            Recovery phrase
          </button>
          <button
            type="button"
            onClick={() => setMode("privkey")}
            className={cn(
              "flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              mode === "privkey" ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text"
            )}
          >
            Private key
          </button>
        </div>

        {mode === "mnemonic" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-mnemonic">Recovery phrase</label>
            <Textarea
              id="import-mnemonic"
              value={mnemonic}
              onChange={(e) => setMnemonic(e.target.value)}
              placeholder="word1 word2 word3 … word24"
              rows={4}
              className={cn(
                "font-mono text-sm",
                trimmedMnemonic.length > 0 && !mnemonicValid && "border-danger",
                trimmedMnemonic.length > 0 && mnemonicValid && "border-success",
              )}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-faint">
                Space or newline separated · 12 or 24 words (BIP-39)
              </span>
              {trimmedMnemonic.length > 0 && (
                <Badge
                  variant="outline"
                  className={
                    mnemonicValid
                      ? "border-success/30 text-success"
                      : "border-danger/30 text-danger"
                  }
                >
                  {mnemonicValid ? "valid" : "invalid"}
                </Badge>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-privkey">Private key (base64)</label>
            <Input
              id="import-privkey"
              value={privKey}
              onChange={(e) => setPrivKey(e.target.value)}
              placeholder="XcxHYHpg8ppVnkRLuPnb6THiMb6w0DqWJdDh9IKa20w="
              className={cn(
                "font-mono text-sm",
                trimmedPrivKey.length > 0 && !privKeyValid && "border-danger",
                trimmedPrivKey.length > 0 && privKeyValid && "border-success",
              )}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-faint">
                The <code className="font-mono">priv_b64</code> field from Octra webcli&apos;s
                wallet file — 32-byte Ed25519 seed (44 chars b64).
              </span>
              {trimmedPrivKey.length > 0 && (
                <Badge
                  variant="outline"
                  className={
                    privKeyValid
                      ? "border-success/30 text-success"
                      : "border-danger/30 text-danger"
                  }
                >
                  {privKeyValid ? "valid" : "invalid"}
                </Badge>
              )}
            </div>
          </div>
        )}

        <PinFields
          pin={pin}
          onPinChange={setPin}
          confirm={confirm}
          onConfirmChange={setConfirm}
          show={show}
          onToggleShow={() => setShow((s) => !s)}
        />

        <PinStrength pin={pin} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="import-label">Wallet label</label>
          <Input
            id="import-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={48}
          />
        </div>

        {submitError && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}

        <Button onClick={onSubmit} disabled={!canSubmit} className="w-full">
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Importing…
            </>
          ) : (
            <>
              <Download className="size-4" />
              Import wallet
            </>
          )}
        </Button>
      </CardBody>
    </Card>
  );
}
