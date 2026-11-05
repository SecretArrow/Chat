"use client";

/**
 * CircleDetailDrawer — slide-in drawer from the right.
 *
 * Shows circle metadata, member list with role badges, slot indices,
 * admin actions (promote/demote/kick), encryption details, storage
 * entry count, and a "leave" button (except for DMs).
 */
import { useMemo } from "react";
import {
  Clock,
  Crown,
  Eye,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Shield,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import type { CircleKind, MemberRole, StorageEntry } from "@/lib/octra/circle";
import { formatDate, shortAddress } from "@/lib/utils";
import {
  Avatar,
  Badge,
  CopyButton,
  Drawer,
  EmptyState,
  Tooltip,
  useToast,
} from "@/components/_primitives";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { AddMemberModal } from "@/components/chat/add-member-modal";

/** Stable empty array constant — avoids the Zustand "getSnapshot should be
 *  cached to avoid an infinite loop" error when entries haven't loaded yet. */
const EMPTY_ENTRIES: StorageEntry[] = [];

interface CircleDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  circleId: string;
}

const roleVariant: Record<MemberRole, "accent" | "default" | "outline"> = {
  admin: "accent",
  member: "default",
  viewer: "outline",
};

const roleIcon: Record<MemberRole, React.ReactNode> = {
  admin: <Crown className="h-3 w-3" />,
  member: <Users className="h-3 w-3" />,
  viewer: <Eye className="h-3 w-3" />,
};

const encryptionDetail: Record<CircleKind, { label: string; icon: React.ReactNode }> = {
  dm: {
    label: "Curve25519 ECDH + XSalsa20-Poly1305 (crypto_box.after)",
    icon: <Lock className="h-4 w-4" />,
  },
  room: {
    label: "Shared symmetric key derived from room's Curve25519 public (anyone can read)",
    icon: <Globe className="h-4 w-4" />,
  },
  group: {
    label: "Per-recipient envelopes: message key wrapped with X25519 ECDH + secretbox",
    icon: <KeyRound className="h-4 w-4" />,
  },
};

export function CircleDetailDrawer({
  open,
  onOpenChange,
  circleId,
}: CircleDetailDrawerProps) {
  const circle = useChatStore((s) => s.circles.find((c) => c.id === circleId));
  const identity = useChatStore((s) => s.identity);
  const entries = useChatStore((s) =>
    circle && s.entries[circle.id] ? s.entries[circle.id] : EMPTY_ENTRIES,
  );
  const contacts = useChatStore((s) => s.contacts);
  const leaveMember = useChatStore((s) => s.leaveMember);
  const promote = useChatStore((s) => s.promote);
  const removeCircle = useChatStore((s) => s.removeCircle);
  const setView = useChatStore((s) => s.setView);
  const { toast } = useToast();
  const [showAddMember, setShowAddMember] = useState(false);

  const isAdmin = useMemo(() => {
    if (!circle || !identity) return false;
    const me = circle.members.find((m) => m.address === identity.address);
    return me?.role === "admin";
  }, [circle, identity]);

  if (!circle || !identity) {
    return <Drawer open={open} onOpenChange={onOpenChange} title="Circle details" />;
  }

  const totalBytes = entries.reduce(
    (sum, e) => sum + JSON.stringify(e.payload).length,
    0,
  );

  const onLeave = async () => {
    if (!circle) return;
    await leaveMember(circle.id, identity.address);
    if (circle.members.length <= 1) {
      // I was the last member — delete the circle
      await removeCircle(circle.id);
    }
    toast({
      title: "Left circle",
      description: circle.name,
      variant: "default",
    });
    setView({ kind: "app", section: "messages" });
    onOpenChange(false);
  };

  const counterparty =
    circle.kind === "dm"
      ? circle.members.find((m) => m.address !== identity.address)
      : null;

  const contactMap = new Map(contacts.map((c) => [c.address, c.nickname]));

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={circle.name}
      description={
        <span className="font-mono text-[10px]">{circle.id}</span>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Kind badge + meta */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent">{circle.kind.toUpperCase()}</Badge>
          <Badge variant="outline">
            <Clock className="h-3 w-3" />
            {formatDate(circle.createdAt)}
          </Badge>
          <Badge variant="outline">
            Created by {shortAddress(circle.createdBy, 6, 4)}
          </Badge>
        </div>

        {circle.description && (
          <p className="text-sm text-text-muted">{circle.description}</p>
        )}

        {/* Encryption details */}
        <div className="rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-text mb-1">
            <Shield className="h-3.5 w-3.5 text-success" />
            Encryption
          </div>
          <div className="flex items-start gap-2 text-xs text-text-muted">
            <span className="text-accent shrink-0 mt-0.5">
              {encryptionDetail[circle.kind].icon}
            </span>
            <span>{encryptionDetail[circle.kind].label}</span>
          </div>
        </div>

        {/* Kind-specific info */}
        {circle.kind === "room" && circle.roomCurvePub && (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs font-semibold text-text mb-1.5 flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-accent" />
              Room Curve Pub
            </p>
            <p className="text-[10px] text-text-muted mb-2">
              Share this with anyone who wants to join — they need it to derive
              the symmetric decryption key.
            </p>
            <code className="block bg-surface-2 rounded px-2 py-1.5 text-[10px] font-mono break-all text-text">
              {circle.roomCurvePub}
            </code>
            <div className="mt-2 flex justify-end">
              <CopyButton value={circle.roomCurvePub} label="Copy room pub" />
            </div>
          </div>
        )}

        {circle.kind === "dm" && counterparty && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <p className="text-xs font-semibold text-text">Counterparty</p>
            <div>
              <p className="text-[10px] text-text-muted mb-0.5">Octra address</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface-2 rounded px-2 py-1 text-[10px] font-mono break-all text-text">
                  {counterparty.address}
                </code>
                <CopyButton value={counterparty.address} />
              </div>
            </div>
            <div>
              <p className="text-[10px] text-text-muted mb-0.5">Curve pub (cp_…)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-surface-2 rounded px-2 py-1 text-[10px] font-mono break-all text-text">
                  {counterparty.curvePub}
                </code>
                <CopyButton value={counterparty.curvePub} />
              </div>
            </div>
          </div>
        )}

        {/* Members */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-surface-2/50 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-text inline-flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Members ({circle.members.length})
            </h4>
            {isAdmin && circle.kind !== "dm" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowAddMember(true)}
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add
              </Button>
            )}
          </div>
          <ul className="divide-y divide-border">
            {circle.members.map((m) => {
              const isMe = m.address === identity.address;
              const name = isMe ? "You" : (contactMap.get(m.address) ?? shortAddress(m.address, 6, 4));
              return (
                <li key={m.address + m.slotIndex} className="px-3 py-2 flex items-center gap-2">
                  <Avatar name={name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text truncate">{name}</p>
                    <p className="text-[10px] text-text-faint truncate font-mono">
                      {shortAddress(m.address, 8, 6)}
                    </p>
                  </div>
                  <span className="text-[10px] text-text-faint shrink-0">
                    slot {m.slotIndex}
                  </span>
                  <Badge variant={roleVariant[m.role]} className="shrink-0">
                    {roleIcon[m.role]}
                    {m.role}
                  </Badge>
                  {isAdmin && !isMe && circle.kind !== "dm" && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      {m.role !== "admin" && (
                        <Tooltip content="Promote to admin">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => promote(circle.id, m.address, "admin")}
                            aria-label="Promote to admin"
                          >
                            <Crown className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      )}
                      {m.role === "admin" && (
                        <Tooltip content="Demote to member">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => promote(circle.id, m.address, "member")}
                            aria-label="Demote to member"
                          >
                            <Users className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      )}
                      <Tooltip content="Remove member">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-danger hover:text-danger"
                          onClick={() => leaveMember(circle.id, m.address)}
                          aria-label="Remove member"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Storage info */}
        <div className="rounded-lg border border-border p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-muted">Storage entries</span>
            <span className="font-semibold text-text">{entries.length}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-text-muted">Encrypted payload size</span>
            <span className="font-semibold text-text">
              {(totalBytes / 1024).toFixed(2)} KB
            </span>
          </div>
        </div>

        {/* Leave */}
        {circle.kind !== "dm" && (
          <Button variant="danger" onClick={onLeave} className="w-full">
            <LogOut className="h-4 w-4" />
            Leave {circle.kind}
          </Button>
        )}

        {entries.length === 0 && (
          <EmptyState
            className="py-6"
            icon={<Users className="h-5 w-5" />}
            title="No activity yet"
            description="Send the first encrypted message to start this circle's storage log."
          />
        )}
      </div>

      {circle.kind !== "dm" && (
        <AddMemberModal
          open={showAddMember}
          onOpenChange={setShowAddMember}
          circleId={circle.id}
        />
      )}
    </Drawer>
  );
}

export type { CircleDetailDrawerProps };
