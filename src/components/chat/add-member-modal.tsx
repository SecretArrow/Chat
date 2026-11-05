"use client";

/**
 * AddMemberModal — adds members to a circle.
 *
 * For groups: pick from contacts (joinMember).
 * For rooms: paste an Octra address + Curve pub (cp_…) (joinMember).
 */
import { useMemo, useState } from "react";
import { Check, UserPlus, Users } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import type { CircleMember } from "@/lib/octra/circle";
import { decodeCurvePub, isValidOctraAddress } from "@/lib/octra/crypto";
import { cn, shortAddress } from "@/lib/utils";
import {
  Avatar,
  Badge,
  EmptyState,
  Field,
  Modal,
  useToast,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AddMemberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  circleId: string;
}

export function AddMemberModal({
  open,
  onOpenChange,
  circleId,
}: AddMemberModalProps) {
  const circle = useChatStore((s) => s.circles.find((c) => c.id === circleId));
  const contacts = useChatStore((s) => s.contacts);
  const joinMember = useChatStore((s) => s.joinMember);
  const { toast } = useToast();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addr, setAddr] = useState("");
  const [cp, setCp] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Contacts not already in circle
  const availableContacts = useMemo(() => {
    if (!circle) return [];
    const inCircle = new Set(circle.members.map((m) => m.address));
    return contacts.filter((c) => !inCircle.has(c.address));
  }, [circle, contacts]);

  if (!circle) return null;

  const isRoom = circle.kind === "room";
  const isGroup = circle.kind === "group";

  const reset = () => {
    setSelected(new Set());
    setAddr("");
    setCp("");
  };

  const onToggle = (id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onAddGroup = async () => {
    if (!circle) return;
    setSubmitting(true);
    try {
      const toAdd = availableContacts.filter((c) => selected.has(c.id));
      for (const c of toAdd) {
        const member: CircleMember = {
          address: c.address,
          curvePub: c.curvePub,
          role: "member",
          joinedAt: Date.now(),
          invitedBy: useChatStore.getState().identity?.address ?? "",
          slotIndex: circle.slots.length, // approximate; circle will be re-read after each add
        };
        await joinMember(circle.id, member);
      }
      toast({
        title: `Added ${toAdd.length} member${toAdd.length === 1 ? "" : "s"}`,
        variant: "success",
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to add members",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const onAddRoom = async () => {
    if (!circle) return;
    if (!isValidOctraAddress(addr)) {
      toast({ title: "Invalid Octra address", variant: "danger" });
      return;
    }
    if (!cp.startsWith("cp_")) {
      toast({ title: "Curve pub must start with cp_", variant: "danger" });
      return;
    }
    try {
      decodeCurvePub(cp); // validate
    } catch {
      toast({ title: "Invalid curve pub encoding", variant: "danger" });
      return;
    }
    setSubmitting(true);
    try {
      const member: CircleMember = {
        address: addr,
        curvePub: cp,
        role: "member",
        joinedAt: Date.now(),
        invitedBy: useChatStore.getState().identity?.address ?? "",
        slotIndex: circle.slots.length,
      };
      await joinMember(circle.id, member);
      toast({ title: "Member added", variant: "success" });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Failed to add member",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
      title={
        <span className="inline-flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-accent" />
          Add member to {circle.name}
        </span>
      }
      description={
        isRoom
          ? "Anyone with an Octra address + Curve pub can join this public room."
          : "Select contacts to invite. New members get per-recipient envelopes for past messages encrypted from now on."
      }
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          {isGroup ? (
            <Button onClick={onAddGroup} loading={submitting} disabled={selected.size === 0}>
              Add {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          ) : (
            <Button onClick={onAddRoom} loading={submitting} disabled={!addr || !cp}>
              Add member
            </Button>
          )}
        </>
      }
    >
      {isGroup ? (
        availableContacts.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No contacts to add"
            description="Add contacts first via the Contacts tab, then come back here to invite them."
          />
        ) : (
          <ul className="flex flex-col gap-1 max-h-80 overflow-y-auto -mx-1 px-1">
            {availableContacts.map((c) => {
              const isSel = selected.has(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(c.id)}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-lg p-2 text-left transition-colors",
                      isSel ? "bg-accent-soft" : "hover:bg-surface-2/70",
                    )}
                  >
                    <Avatar name={c.nickname} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-text truncate">
                        {c.nickname}
                      </p>
                      <p className="text-[10px] text-text-faint font-mono truncate">
                        {shortAddress(c.address, 8, 6)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors",
                        isSel
                          ? "bg-accent border-accent text-accent-fg"
                          : "border-border-strong text-transparent",
                      )}
                      aria-hidden
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <div className="space-y-3">
          <Field
            label="Octra address"
            helperText="The recipient's wallet address (oct…, 47 chars)."
          >
            <Input
              value={addr}
              onChange={(e) => setAddr(e.target.value.trim())}
              placeholder="oct…"
              className="font-mono"
            />
          </Field>
          <Field
            label="Curve25519 public key"
            helperText="Encoded as cp_<base64>. The recipient must share this with you out-of-band."
          >
            <Input
              value={cp}
              onChange={(e) => setCp(e.target.value.trim())}
              placeholder="cp_…"
              className="font-mono"
            />
          </Field>
          <div className="rounded-md border border-border bg-surface-2/50 p-3 text-xs text-text-muted">
            <Badge variant="outline" className="mb-1">Public room</Badge>{" "}
            Members share a symmetric key derived from the room&rsquo;s Curve25519
            public key — anyone with the room ID can read, but only members can post.
          </div>
        </div>
      )}
    </Modal>
  );
}

export type { AddMemberModalProps };
