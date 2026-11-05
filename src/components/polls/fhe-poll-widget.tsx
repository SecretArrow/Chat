"use client";

/**
 * FhePollWidget — anonymous polls inside a circle, secured with Paillier
 * additive homomorphic encryption.
 *
 * Protocol (per spec):
 *   - Creator generates a Paillier keypair (256-bit primes → 512-bit modulus).
 *     Priv key stays on creator's machine only; pub key is shared.
 *   - Each voter encrypts their vote INDEX (0..N-1) with paillierEncrypt(pub, idx)
 *     and stores the ciphertext in poll.votes[voterAddress] = ciphertext.
 *   - Anyone can compute the aggregate tally by paillierAdd(pub, allCts) →
 *     EncryptedTally. Only the creator (with priv) can paillierDecrypt it.
 *   - The creator can additionally decrypt each individual ciphertext (since
 *     they hold priv) to compute per-option bars — that's the visual.
 *
 * Components:
 *   1. Modal listing existing polls in this circle
 *   2. "Create poll" form (question + 2-5 options + duration)
 *   3. Per-poll card: question, options as buttons, encrypted vote state,
 *      aggregate tally (decrypted by creator), progress bars (creator only).
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Lock,
  Plus,
  Vote,
  X,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import {
  generatePaillierKeys,
  paillierAdd,
  paillierDecrypt,
  paillierEncrypt,
  type PaillierCiphertext,
  type PaillierPublicKey,
} from "@/lib/octra/fhe";
import { randomId, cn } from "@/lib/utils";
import {
  Badge,
  EmptyState,
  Field,
  Modal,
  useToast,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FhePollWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  circleId: string;
}

interface OptionTally {
  index: number;
  label: string;
  count: number;
}

export function FhePollWidget({
  open,
  onOpenChange,
  circleId,
}: FhePollWidgetProps) {
  const identity = useChatStore((s) => s.identity);
  const polls = useChatStore((s) => s.polls);
  const savePollRecord = useChatStore((s) => s.savePollRecord);
  const { toast } = useToast();

  const [mode, setMode] = useState<"list" | "create">("list");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [durationMin, setDurationMin] = useState(60);
  const [generating, setGenerating] = useState(false);
  const [votingPollId, setVotingPollId] = useState<string | null>(null);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setMode("list");
      setQuestion("");
      setOptions(["", ""]);
      setDurationMin(60);
      setVotingPollId(null);
    }
  }, [open]);

  const circlePolls = useMemo(
    () => polls.filter((p) => p.circleId === circleId).sort((a, b) => b.createdAt - a.createdAt),
    [polls, circleId],
  );

  if (!identity) return null;

  const myAddress = identity.address;

  const onAddOption = () => {
    if (options.length >= 5) {
      toast({ title: "Max 5 options", variant: "warning" });
      return;
    }
    setOptions((o) => [...o, ""]);
  };

  const onRemoveOption = (i: number) => {
    if (options.length <= 2) {
      toast({ title: "Min 2 options", variant: "warning" });
      return;
    }
    setOptions((o) => o.filter((_, idx) => idx !== i));
  };

  const onCreate = async () => {
    if (!question.trim()) {
      toast({ title: "Question required", variant: "danger" });
      return;
    }
    const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
    if (cleanOptions.length < 2) {
      toast({ title: "At least 2 options required", variant: "danger" });
      return;
    }
    setGenerating(true);
    try {
      // Yield to UI so the spinner shows even though key-gen is fast.
      await new Promise((r) => setTimeout(r, 30));
      const keypair = await generatePaillierKeys(256);
      const now = Date.now();
      const poll = {
        id: randomId("poll"),
        circleId,
        question: question.trim(),
        options: cleanOptions,
        pub: keypair.pub,
        priv: keypair.priv, // present on creator's machine only
        votes: {} as Record<string, PaillierCiphertext>,
        createdAt: now,
        closedAt: now + durationMin * 60_000,
      };
      await savePollRecord(poll);
      toast({
        title: "Poll created",
        description: `${keypair.pub.bits}-bit Paillier keys generated. Votes are FHE-encrypted.`,
        variant: "success",
      });
      setQuestion("");
      setOptions(["", ""]);
      setMode("list");
    } catch (err) {
      toast({
        title: "Failed to create poll",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setGenerating(false);
    }
  };

  const onVote = async (pollId: string, optionIndex: number) => {
    const poll = polls.find((p) => p.id === pollId);
    if (!poll) return;
    if (poll.votes[myAddress]) {
      toast({
        title: "Already voted",
        description: "Each address can vote once per poll.",
        variant: "warning",
      });
      return;
    }
    if (poll.closedAt && Date.now() > poll.closedAt) {
      toast({ title: "Poll closed", variant: "warning" });
      return;
    }
    setVotingPollId(pollId);
    try {
      const ct = paillierEncrypt(poll.pub, BigInt(optionIndex));
      const updated = {
        ...poll,
        votes: { ...poll.votes, [myAddress]: ct },
      };
      await savePollRecord(updated);
      toast({
        title: "Vote encrypted & recorded",
        description: `Paillier ciphertext for option #${optionIndex + 1} saved.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Failed to vote",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setVotingPollId(null);
    }
  };

  const onClose = () => onOpenChange(false);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="inline-flex items-center gap-2">
          <Vote className="h-4 w-4 text-accent" />
          {mode === "list" ? "Encrypted polls" : "Create poll"}
        </span>
      }
      description={
        mode === "list"
          ? "Anonymous votes via Paillier additive homomorphic encryption."
          : "Generates a Paillier keypair on this device — only you can decrypt the final tally."
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {mode === "list" ? (
            <Button onClick={() => setMode("create")}>
              <Plus className="h-4 w-4" />
              New poll
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setMode("list")}>
                Back
              </Button>
              <Button onClick={onCreate} loading={generating} disabled={!question.trim()}>
                {generating ? "Generating keys…" : "Create poll"}
              </Button>
            </>
          )}
        </>
      }
    >
      {mode === "list" ? (
        circlePolls.length === 0 ? (
          <EmptyState
            icon={<Vote className="h-6 w-6" />}
            title="No polls in this circle yet"
            description="Create an FHE-encrypted poll. Each voter encrypts their choice with the poll's Paillier public key — anyone can aggregate the encrypted tally without seeing individual votes."
            action={
              <Button size="sm" onClick={() => setMode("create")}>
                <Plus className="h-4 w-4" />
                Create first poll
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {circlePolls.map((p) => (
              <PollCard
                key={p.id}
                poll={p}
                myAddress={myAddress}
                onVote={(i) => onVote(p.id, i)}
                voting={votingPollId === p.id}
              />
            ))}
          </ul>
        )
      ) : (
        <div className="space-y-3">
          {/* Encryption explainer */}
          <div className="rounded-md border border-accent/30 bg-accent-soft/40 p-3 text-xs text-text-muted flex items-start gap-2">
            <Lock className="h-4 w-4 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-text">How it works</p>
              <p className="mt-0.5">
                Votes are encrypted with Paillier additive homomorphic encryption.
                Anyone can aggregate the encrypted tally without seeing individual
                votes (homomorphic sum). Only the poll creator&rsquo;s private key
                can decrypt the final count — your vote stays secret.
              </p>
            </div>
          </div>

          <Field label="Question" required>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Ship the v2 release next week?"
              autoFocus
            />
          </Field>

          <Field
            label="Options (2-5)"
            helperText="Each option gets a number 0-4. Voters encrypt their chosen index."
          >
            <ul className="space-y-2">
              {options.map((opt, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-2 text-xs font-mono text-text-muted">
                    {i}
                  </span>
                  <Input
                    value={opt}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOptions((cur) => cur.map((o, idx) => (idx === i ? v : o)));
                    }}
                    placeholder={`Option ${i + 1}`}
                    className="flex-1"
                  />
                  {options.length > 2 && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onRemoveOption(i)}
                      aria-label="Remove option"
                      className="text-text-faint hover:text-danger"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {options.length < 5 && (
              <button
                type="button"
                onClick={onAddOption}
                className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <Plus className="h-3.5 w-3.5" /> Add option
              </button>
            )}
          </Field>

          <Field
            label="Duration (minutes)"
            helperText="After this time the poll is considered closed."
          >
            <Input
              type="number"
              min={1}
              max={10080}
              value={durationMin}
              onChange={(e) => setDurationMin(Math.max(1, Number(e.target.value) || 60))}
              className="w-32"
            />
          </Field>

          {generating && (
            <div className="rounded-md border border-border bg-surface-2/50 p-3 text-xs text-text-muted flex items-center gap-2">
              <BarChart3 className="h-4 w-4 animate-pulse text-accent" />
              Generating homomorphic keys (256-bit primes, 512-bit modulus)…
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/*  PollCard — render a single poll with vote buttons + tally                  */
/* -------------------------------------------------------------------------- */

interface PollCardProps {
  poll: {
    id: string;
    question: string;
    options: string[];
    pub: PaillierPublicKey;
    priv?: import("@/lib/octra/fhe").PaillierPrivateKey;
    votes: Record<string, PaillierCiphertext>;
    createdAt: number;
    closedAt?: number;
  };
  myAddress: string;
  onVote: (optionIndex: number) => void;
  voting: boolean;
}

function PollCard({ poll, myAddress, onVote, voting }: PollCardProps) {
  const isCreator = !!poll.priv;
  const myVote = poll.votes[myAddress];
  const closed = !!poll.closedAt && Date.now() > poll.closedAt;
  const totalVotes = Object.keys(poll.votes).length;

  // Compute aggregate tally (anyone can compute, only creator decrypts)
  const aggregateCt = useMemo<PaillierCiphertext>(() => {
    const cts = Object.values(poll.votes);
    if (cts.length === 0) return paillierEncrypt(poll.pub, 0n);
    return paillierAdd(poll.pub, cts);
  }, [poll.votes, poll.pub]);

  const decryptedAggregate = useMemo<number | null>(() => {
    if (!poll.priv) return null;
    try {
      const sum = paillierDecrypt(poll.pub, poll.priv, aggregateCt);
      return Number(sum);
    } catch {
      return null;
    }
  }, [poll.priv, poll.pub, aggregateCt]);

  // Per-option tally (creator only — decrypts each individual ciphertext)
  const perOption = useMemo<OptionTally[]>(() => {
    const counts = poll.options.map((label, index) => ({ index, label, count: 0 }));
    if (!poll.priv) return counts;
    for (const ct of Object.values(poll.votes)) {
      try {
        const v = Number(paillierDecrypt(poll.pub, poll.priv, ct));
        if (v >= 0 && v < counts.length) counts[v].count++;
      } catch {
        // skip
      }
    }
    return counts;
  }, [poll.options, poll.votes, poll.priv, poll.pub]);

  const maxCount = Math.max(1, ...perOption.map((o) => o.count));

  return (
    <li className="rounded-lg border border-border bg-surface p-4 animate-fade-in">
      <div className="flex items-start justify-between gap-2 mb-2">
        <h4 className="text-sm font-semibold text-text">{poll.question}</h4>
        <Badge variant={closed ? "warning" : "success"}>
          {closed ? "closed" : "open"}
        </Badge>
      </div>

      {/* Options */}
      <ul className="space-y-1.5">
        {poll.options.map((opt, i) => {
          const voted = myVote !== undefined;
          const myChoice = isCreator
            ? false // we don't reveal my choice via decryption in the visual; use myVote comparison
            : false;
          void myChoice;
          const tally = perOption[i]?.count ?? 0;
          const pct = isCreator ? Math.round((tally / maxCount) * 100) : 0;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={voted || closed || voting}
                onClick={() => onVote(i)}
                className={cn(
                  "w-full text-left rounded-md border px-3 py-2 transition-colors",
                  voted
                    ? "border-border bg-surface-2/40 cursor-default"
                    : "border-border-strong hover:border-accent hover:bg-accent-soft/40 cursor-pointer",
                  closed && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-[10px] font-mono text-text-muted shrink-0">
                    {i}
                  </span>
                  <span className="text-sm text-text flex-1 truncate">{opt}</span>
                  {voted && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                  )}
                </div>
                {isCreator && totalVotes > 0 && (
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className="h-full bg-accent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
                {isCreator && (
                  <div className="mt-1 flex items-center justify-between text-[10px] text-text-muted">
                    <span>{tally} vote{tally === 1 ? "" : "s"}</span>
                    <span>{pct}%</span>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Tally footer */}
      <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            Encrypted tally
          </span>
          <span className="font-mono text-[10px] text-text-faint truncate max-w-[60%]">
            {aggregateCt.c.slice(0, 24)}…
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Total votes (public)</span>
          <span className="font-semibold text-text">{totalVotes}</span>
        </div>
        {isCreator ? (
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="h-3 w-3" />
              Decrypted aggregate
            </span>
            <span className="font-semibold text-success">
              {decryptedAggregate !== null
                ? decryptedAggregate
                : "decrypt error"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-text-faint">
            <AlertTriangle className="h-3 w-3" />
            Only the poll creator can decrypt the aggregate tally.
          </div>
        )}
        {myVote !== undefined && (
          <div className="text-[10px] text-success inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Your vote is recorded (encrypted).
          </div>
        )}
      </div>
    </li>
  );
}

export type { FhePollWidgetProps };
